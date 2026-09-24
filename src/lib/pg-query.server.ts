// Minimal PostgREST/supabase-js compatible query builder over node-postgres.
// Used when the app runs on AWS (DATA_BACKEND=aws) against RDS PostgreSQL.
// Only parameterised SQL is produced; identifiers are validated.
import type { Pool, PoolClient } from "pg";

type Row = Record<string, unknown>;
type PgErr = { message: string; code?: string; details?: string; hint?: string };
export type Result<T = any> = { data: T; error: PgErr | null; count: number | null; status: number; statusText: string };

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function ident(name: string): string {
  const n = name.trim();
  if (!IDENT.test(n)) throw new Error(`Invalid identifier: ${name}`);
  return `"${n}"`;
}

type ColMeta = { types: Map<string, string>; pk: string[] };
const metaCache = new Map<string, Promise<ColMeta>>();

async function tableMeta(pool: Pool, table: string): Promise<ColMeta> {
  let p = metaCache.get(table);
  if (!p) {
    p = (async () => {
      const cols = await pool.query(
        `select column_name, data_type, udt_name from information_schema.columns where table_schema='public' and table_name=$1`,
        [table],
      );
      const pk = await pool.query(
        `select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum = any(i.indkey)
         where i.indrelid = ('public.' || quote_ident($1))::regclass and i.indisprimary`,
        [table],
      );
      const types = new Map<string, string>();
      for (const r of cols.rows) types.set(r.column_name, r.data_type === "ARRAY" ? `${String(r.udt_name).replace(/^_/, "")}[]` : r.udt_name);
      return { types, pk: pk.rows.map((r) => r.attname as string) };
    })();
    metaCache.set(table, p);
    p.catch(() => metaCache.delete(table));
  }
  return p;
}

function serialize(meta: ColMeta, col: string, v: unknown): unknown {
  if (v === undefined) return null;
  const t = meta.types.get(col);
  if ((t === "jsonb" || t === "json") && v !== null) return JSON.stringify(v);
  return v;
}

function parseLiteral(v: string): unknown {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

class Params {
  values: unknown[] = [];
  add(v: unknown) { this.values.push(v); return `$${this.values.length}`; }
}

type Filter = (p: Params, meta: ColMeta) => string;

function opSql(col: string, op: string, raw: unknown, p: Params, meta: ColMeta, negate = false): string {
  const c = ident(col);
  let sql: string;
  switch (op) {
    case "eq": sql = `${c} = ${p.add(raw)}`; break;
    case "neq": sql = `${c} <> ${p.add(raw)}`; break;
    case "gt": sql = `${c} > ${p.add(raw)}`; break;
    case "gte": sql = `${c} >= ${p.add(raw)}`; break;
    case "lt": sql = `${c} < ${p.add(raw)}`; break;
    case "lte": sql = `${c} <= ${p.add(raw)}`; break;
    case "like": sql = `${c} LIKE ${p.add(String(raw).replace(/\*/g, "%"))}`; break;
    case "ilike": sql = `${c} ILIKE ${p.add(String(raw).replace(/\*/g, "%"))}`; break;
    case "is": {
      const v = typeof raw === "string" ? parseLiteral(raw) : raw;
      sql = v === null ? `${c} IS NULL` : v === true ? `${c} IS TRUE` : `${c} IS FALSE`;
      break;
    }
    case "in": {
      let arr: unknown[];
      if (Array.isArray(raw)) arr = raw;
      else arr = String(raw).replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter((s) => s.length);
      sql = arr.length ? `${c} = ANY(${p.add(arr)})` : "FALSE";
      break;
    }
    case "cs": case "contains": {
      const t = meta.types.get(col) ?? "";
      if (t.endsWith("[]")) sql = `${c} @> ${p.add(raw)}::${t}`;
      else sql = `${c} @> ${p.add(JSON.stringify(raw))}::jsonb`;
      break;
    }
    default: throw new Error(`Unsupported filter operator: ${op}`);
  }
  return negate ? `NOT (${sql})` : sql;
}

// Parse PostgREST logic trees: "a.eq.1,and(b.gt.2,c.is.null)"
function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function logicSql(expr: string, joiner: "OR" | "AND", p: Params, meta: ColMeta): string {
  const parts = splitTop(expr).map((part) => {
    const t = part.trim();
    const m = /^(and|or|not\.and|not\.or)\((.*)\)$/s.exec(t);
    if (m) {
      const neg = m[1].startsWith("not.");
      const inner = logicSql(m[2], m[1].endsWith("and") ? "AND" : "OR", p, meta);
      return neg ? `NOT ${inner}` : inner;
    }
    const [col, ...rest] = t.split(".");
    let negate = false;
    if (rest[0] === "not") { negate = true; rest.shift(); }
    const op = rest.shift()!;
    const val = rest.join(".");
    return opSql(col, op, op === "is" ? val : parseLiteral(val), p, meta, negate);
  });
  return `(${parts.join(` ${joiner} `)})`;
}

class Builder implements PromiseLike<Result> {
  private action: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private columns = "*";
  private returning: string | null = null;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private off: number | null = null;
  private countMode: "exact" | null = null;
  private head = false;
  private single: "one" | "maybe" | null = null;
  private payload: Row[] = [];
  private onConflict: string | null = null;
  private ignoreDuplicates = false;

  constructor(private pool: Pool, private table: string) { ident(table); }

  select(cols = "*", opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (this.action === "select") {
      this.columns = cols;
      if (opts?.count) this.countMode = "exact";
      if (opts?.head) this.head = true;
    } else {
      this.returning = cols;
    }
    return this;
  }
  insert(rows: Row | Row[], opts?: { count?: string; defaultToNull?: boolean }) {
    this.action = "insert"; this.payload = Array.isArray(rows) ? rows : [rows];
    if (opts?.count) this.countMode = "exact";
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean; count?: string }) {
    this.action = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows];
    this.onConflict = opts?.onConflict ?? null; this.ignoreDuplicates = !!opts?.ignoreDuplicates;
    if (opts?.count) this.countMode = "exact";
    return this;
  }
  update(values: Row, opts?: { count?: string }) {
    this.action = "update"; this.payload = [values];
    if (opts?.count) this.countMode = "exact";
    return this;
  }
  delete(opts?: { count?: string }) {
    this.action = "delete";
    if (opts?.count) this.countMode = "exact";
    return this;
  }

  private f(fn: Filter) { this.filters.push(fn); return this; }
  eq(c: string, v: unknown) { return this.f((p, m) => opSql(c, "eq", v, p, m)); }
  neq(c: string, v: unknown) { return this.f((p, m) => opSql(c, "neq", v, p, m)); }
  gt(c: string, v: unknown) { return this.f((p, m) => opSql(c, "gt", v, p, m)); }
  gte(c: string, v: unknown) { return this.f((p, m) => opSql(c, "gte", v, p, m)); }
  lt(c: string, v: unknown) { return this.f((p, m) => opSql(c, "lt", v, p, m)); }
  lte(c: string, v: unknown) { return this.f((p, m) => opSql(c, "lte", v, p, m)); }
  like(c: string, v: string) { return this.f((p, m) => opSql(c, "like", v, p, m)); }
  ilike(c: string, v: string) { return this.f((p, m) => opSql(c, "ilike", v, p, m)); }
  is(c: string, v: unknown) { return this.f((p, m) => opSql(c, "is", v, p, m)); }
  in(c: string, v: unknown[]) { return this.f((p, m) => opSql(c, "in", v, p, m)); }
  contains(c: string, v: unknown) { return this.f((p, m) => opSql(c, "cs", v, p, m)); }
  match(obj: Row) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  not(c: string, op: string, v: unknown) { return this.f((p, m) => opSql(c, op, v, p, m, true)); }
  filter(c: string, op: string, v: unknown) {
    if (op.startsWith("not.")) return this.not(c, op.slice(4), v);
    return this.f((p, m) => opSql(c, op, v, p, m));
  }
  or(expr: string) { return this.f((p, m) => logicSql(expr, "OR", p, m)); }
  order(c: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const dir = opts?.ascending === false ? "DESC" : "ASC";
    const nulls = opts?.nullsFirst === undefined ? "" : opts.nullsFirst ? " NULLS FIRST" : " NULLS LAST";
    this.orders.push(`${ident(c)} ${dir}${nulls}`);
    return this;
  }
  limit(n: number) { this.lim = n; return this; }
  range(from: number, to: number) { this.off = from; this.lim = to - from + 1; return this; }
  single() { this.single = "one"; return this; }
  maybeSingle() { this.single = "maybe"; return this; }
  returns() { return this; }
  abortSignal() { return this; }
  throwOnError() { return this; }

  private colList(cols: string): string {
    const c = cols.replace(/\s+/g, "");
    if (c === "*" || c === "") return "*";
    return c.split(",").map((part) => {
      const [a, b] = part.split(":");
      return b ? `${ident(b)} AS ${ident(a)}` : ident(a);
    }).join(", ");
  }

  private where(p: Params, meta: ColMeta): string {
    if (!this.filters.length) return "";
    return " WHERE " + this.filters.map((fn) => fn(p, meta)).join(" AND ");
  }

  private async build(meta: ColMeta): Promise<{ sql: string; values: unknown[]; countSql?: { sql: string; values: unknown[] } }> {
    const t = `public.${ident(this.table)}`;
    const p = new Params();
    if (this.action === "select") {
      const w = this.where(p, meta);
      const countSql = this.countMode ? { sql: `SELECT count(*)::bigint AS c FROM ${t}${w}`, values: [...p.values] } : undefined;
      let sql = `SELECT ${this.colList(this.columns)} FROM ${t}${w}`;
      if (this.orders.length) sql += ` ORDER BY ${this.orders.join(", ")}`;
      if (this.lim !== null) sql += ` LIMIT ${Math.max(0, Math.floor(this.lim))}`;
      if (this.off !== null) sql += ` OFFSET ${Math.max(0, Math.floor(this.off))}`;
      return { sql, values: p.values, countSql };
    }
    const ret = this.returning !== null ? ` RETURNING ${this.colList(this.returning)}` : this.countMode ? " RETURNING 1" : "";
    if (this.action === "delete") {
      return { sql: `DELETE FROM ${t}${this.where(p, meta)}${ret}`, values: p.values };
    }
    if (this.action === "update") {
      const vals = this.payload[0] ?? {};
      const sets = Object.keys(vals).filter((k) => vals[k] !== undefined).map((k) => `${ident(k)} = ${p.add(serialize(meta, k, vals[k]))}`);
      if (!sets.length) throw new Error("Update without values");
      return { sql: `UPDATE ${t} SET ${sets.join(", ")}${this.where(p, meta)}${ret}`, values: p.values };
    }
    // insert / upsert
    const keys = Array.from(new Set(this.payload.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined))));
    if (!keys.length) throw new Error("Insert without values");
    const rowsSql = this.payload.map((r) => `(${keys.map((k) => (k in r && r[k] !== undefined ? p.add(serialize(meta, k, r[k])) : "DEFAULT")).join(", ")})`);
    let sql = `INSERT INTO ${t} (${keys.map(ident).join(", ")}) VALUES ${rowsSql.join(", ")}`;
    if (this.action === "upsert") {
      const target = (this.onConflict ? this.onConflict.split(",") : meta.pk).map((s) => s.trim()).filter(Boolean);
      if (!target.length) throw new Error(`No conflict target for ${this.table}`);
      const updates = keys.filter((k) => !target.includes(k));
      sql += ` ON CONFLICT (${target.map(ident).join(", ")}) ` +
        (this.ignoreDuplicates || !updates.length ? "DO NOTHING" : `DO UPDATE SET ${updates.map((k) => `${ident(k)} = EXCLUDED.${ident(k)}`).join(", ")}`);
    }
    return { sql: sql + ret, values: p.values };
  }

  async execute(): Promise<Result> {
    try {
      const meta = await tableMeta(this.pool, this.table);
      const { sql, values, countSql } = await this.build(meta);
      let count: number | null = null;
      if (countSql) count = Number((await this.pool.query(countSql.sql, countSql.values)).rows[0]?.c ?? 0);
      if (this.head) return { data: null, error: null, count, status: 200, statusText: "OK" };
      const res = await this.pool.query(sql, values);
      if (this.action !== "select" && this.countMode) count = res.rowCount ?? 0;
      let data: any = this.action === "select" || this.returning !== null ? res.rows : null;
      if (this.single && Array.isArray(data)) {
        if (data.length === 1) data = data[0];
        else if (data.length === 0 && this.single === "maybe") data = null;
        else return { data: null, error: { code: "PGRST116", message: `JSON object requested, multiple (or no) rows returned (${data.length})` }, count, status: 406, statusText: "Not Acceptable" };
      }
      return { data, error: null, count, status: 200, statusText: "OK" };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e), code: e?.code, details: e?.detail, hint: e?.hint }, count: null, status: 400, statusText: "Bad Request" };
    }
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export function createPgClient(pool: Pool) {
  return {
    from: (table: string) => new Builder(pool, table),
    async rpc(fn: string, args: Row = {}): Promise<Result> {
      try {
        const p = new Params();
        const named = Object.entries(args).map(([k, v]) => `${ident(k)} => ${p.add(v)}`);
        const res = await pool.query(`SELECT * FROM public.${ident(fn)}(${named.join(", ")})`, p.values);
        return { data: res.rows, error: null, count: null, status: 200, statusText: "OK" };
      } catch (e: any) {
        return { data: null, error: { message: e?.message ?? String(e), code: e?.code }, count: null, status: 400, statusText: "Bad Request" };
      }
    },
  };
}

export type { PoolClient };
