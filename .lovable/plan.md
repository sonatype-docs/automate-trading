
## Goal

Bring every backtest engine (Range, Asian Liquidity Sweep, ICT Silver Bullet, Multi-Session ORB, Sweep-hour grid, Entry-zone sweep) to the same feature bar:

- Days: 1–365 slider + numeric input
- Timeframe: selectable from `1m, 3m, 5m, 15m, 1h, 4h`
- Entry: existing modes + fixed offset
- SL/TP: pick one model per run — Fixed USD/%, ATR-based, RR multiple (existing), opposite level (where applicable)
- Trade management: breakeven-at-Nr, trailing stop (ATR or %), partial TP (scale-out X% at Nr, runner to Mr)
- Weekend toggle: independent Sat / Sun skips
- Analytics: inline monthly P&L grid + weekday breakdown per panel, plus a shared `/analytics` dashboard reading the latest cached run per strategy

## Backend

### 1. Shared exit/management module — `src/lib/strategy/exit-model.server.ts` (new)

Single source of truth for TP/SL simulation used by every engine.

```ts
type SlModel =
  | { kind: "rr"; rr: number }
  | { kind: "fixed_usd"; usd: number }
  | { kind: "fixed_pct"; pct: number }
  | { kind: "atr"; mult: number; period: number };

type TpModel =
  | { kind: "rr"; rr: number }
  | { kind: "fixed_usd"; usd: number }
  | { kind: "fixed_pct"; pct: number }
  | { kind: "atr"; mult: number; period: number }
  | { kind: "opposite" } // engines that support it
  | { kind: "midrange" };

type Management = {
  breakevenAtR?: number;      // move SL to entry after price hits N·R
  trailAtrMult?: number;      // trailing stop distance in ATR
  trailPct?: number;          // or % of price
  partial?: { atR: number; sizePct: number }; // e.g. 50% off at 1R, runner continues
};
```

Exposes `simulateExit(side, entry, initialSl, initialTp, futureBars, mgmt, atrSeries)` returning `{ outcome, exitPrice, pnlR, mae, partialsHit }`. All engines call this instead of inlining their own SL/TP loop.

### 2. Shared filters — `src/lib/strategy/filters.ts`

Add `skipSat: boolean`, `skipSun: boolean` (replacing/augmenting current `skipWeekdays`). Helper `shouldSkipWeekday(dateIST, { skipSat, skipSun })`.

### 3. Engine updates

For each of: `backtest-range`, `sweep-liquidity`, `silver-bullet`, `sweep.server`, plus the multi-session ORB and grid/sweep-hour engines:

- Accept `days: number (1..365)`, `timeframe: '1m'|'3m'|'5m'|'15m'|'1h'|'4h'`, `slModel`, `tpModel`, `management`, `skipSat`, `skipSun`.
- Replace inline exit loop with `simulateExit(...)`.
- Compute ATR series once per symbol when any ATR-based model is selected.
- Return, in addition to existing `days`/`equity`, two new aggregates:
  - `monthly: { yyyy_mm: { pnl, trades, wins } }`
  - `weekday: { 0..6: { pnl, trades, wins } }`

### 4. Server functions — `src/lib/strategy.functions.ts`

Bump each backtest server fn's Zod schema:
- `days: z.number().int().min(1).max(365)`
- `timeframe` enum
- Nested `slModel`, `tpModel`, `management` objects (all optional with sensible defaults so old callers keep working)
- `skipSat`, `skipSun`

Persist the latest run per `(strategy, symbol)` into a small `strategy_runs` table (see Schema below) so `/analytics` can render without re-running.

## Schema (single migration)

```sql
create table public.strategy_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  strategy text not null,           -- 'range' | 'sweep' | 'silver_bullet' | 'orb' | ...
  symbol text not null,
  timeframe text not null,
  days integer not null,
  config jsonb not null,            -- full request payload
  summary jsonb not null,           -- summary object
  monthly jsonb not null,           -- {yyyy_mm: {...}}
  weekday jsonb not null,           -- {0..6: {...}}
  equity jsonb not null,            -- equity curve
  created_at timestamptz not null default now()
);

grant select, insert, delete on public.strategy_runs to authenticated;
grant all on public.strategy_runs to service_role;
alter table public.strategy_runs enable row level security;

create policy "own runs read"   on public.strategy_runs for select using (auth.uid() = user_id);
create policy "own runs insert" on public.strategy_runs for insert with check (auth.uid() = user_id);
create policy "own runs delete" on public.strategy_runs for delete using (auth.uid() = user_id);

create index on public.strategy_runs (user_id, strategy, symbol, created_at desc);
```

## Frontend

### 5. Reusable control block — `src/components/backtest-controls.tsx` (new)

`<BacktestControls value onChange />` renders:

- Days (1–365) slider + number input
- Timeframe select (`1m/3m/5m/15m/1h/4h`)
- SL model tabs (RR | Fixed $ | Fixed % | ATR)
- TP model tabs (RR | Fixed $ | Fixed % | ATR | Opposite | Midrange — last two hidden per-engine via `allowedTp` prop)
- Management: breakeven-at-Nr, trailing (ATR mult or %), partial (Nr / size%)
- Weekend toggles: `Skip Saturday`, `Skip Sunday`

Every backtest panel in `src/routes/backtest.tsx` swaps its ad-hoc inputs for this block.

### 6. Inline analytics — `src/components/backtest-analytics.tsx` (new)

Given a result, renders:
- Month grid (rows = months, cols = trades / wins / P&L / best-day / worst-day)
- Weekday breakdown (Mon–Sun with P&L, trades, win rate, avg R)
- Best/worst day-of-week highlight

Mounted at the bottom of each panel's result section.

### 7. Shared dashboard — `src/routes/analytics.tsx`

Add a new "Strategy performance" section that lists the latest saved `strategy_runs` (one card per strategy/symbol) and renders the same monthly + weekday breakdowns. New server fn `listLatestRuns()` returns latest row per `(strategy, symbol)` for the current user.

## Rollout order

1. Migration + `strategy_runs` table
2. `exit-model.server.ts` + weekday filter helper
3. Refactor `backtest-range` first (most complex) end-to-end; verify existing UI still works
4. Roll changes through `sweep-liquidity`, `silver-bullet`, `sweep.server`, ORB, grid engines
5. Build `BacktestControls` + `BacktestAnalytics` and wire into each panel
6. Extend `/analytics` route with the shared dashboard

## Notes / trade-offs

- 365-day 1m backtests are heavy — Shark klines pagination already handles it, but we'll add a small warning badge on the panel when `timeframe=1m && days>60`.
- ATR requires enough warmup bars — engines will silently fetch `period` extra bars before `from_ms`.
- The `strategy_runs` cache is per user; each new run inserts a row and we retain the latest 25 per strategy (cleanup in the same insert server fn).
