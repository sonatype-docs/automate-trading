#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${FILES_BUCKET:?FILES_BUCKET is required}"

target_db="${PGDATABASE:-sharktrader}"
migration_id="${MIGRATION_ID:-lovable-export-2026-09-24}"
export PGSSLMODE="${PGSSLMODE:-require}"

echo "Checking migration marker for ${migration_id}"
if psql -v ON_ERROR_STOP=1 -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '${target_db}'" | grep -qx 1; then
  if psql -v ON_ERROR_STOP=1 -d "${target_db}" -Atqc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'aws_migration_control'" | grep -qx 1 &&
     psql -v ON_ERROR_STOP=1 -d "${target_db}" -Atqc "SELECT 1 FROM public.aws_migration_control WHERE migration_id = '${migration_id}'" | grep -qx 1; then
    echo "Migration ${migration_id} is already complete; leaving S3 and database data unchanged."
    exit 0
  fi
else
  echo "CREATE DATABASE ${target_db}"
  psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"${target_db}\""
fi

export PGDATABASE="${target_db}"

echo "Applying idempotent runtime safety bootstrap"
psql -v ON_ERROR_STOP=1 -f /bootstrap-runtime-safety.sql

work=/work
rm -rf "${work}"
mkdir -p "${work}/migration"
aws s3 cp "s3://${FILES_BUCKET}/migration/" "${work}/migration/" --recursive

for sql in schema.sql drift.sql; do
  if [[ ! -f "${work}/migration/${sql}" ]]; then
    echo "Missing migration/${sql}" >&2
    exit 1
  fi
done

schema_ready="$(psql -v ON_ERROR_STOP=1 -d "${PGDATABASE}" -Atqc "SELECT (to_regclass('public.owner') IS NOT NULL)")"
if [[ "${schema_ready}" == "t" ]]; then
  echo "Target schema already exists; skipping non-idempotent baseline schema replay."
else
  psql -v ON_ERROR_STOP=1 -f "${work}/migration/schema.sql"
fi
psql -v ON_ERROR_STOP=1 -f "${work}/migration/drift.sql"

psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.aws_migration_control (
  migration_id text PRIMARY KEY,
  source_prefix text NOT NULL,
  object_count integer NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
SQL

mapfile -t bases < <(
  find "${work}/migration" -maxdepth 1 -type f -name '*.csv.gz.*' -print |
    sed 's#^.*/##' |
    sed -E 's/(\.part[0-9]+)?\.csv\.gz\.[^.]+$//' |
    sort -u
)

if (( ${#bases[@]} == 0 )); then
  echo "No compressed CSV exports found under migration/" >&2
  exit 1
fi

# The export filenames sort alphabetically, but several tables have foreign-key
# dependencies. Load known parents first so a retry remains deterministic and
# does not require disabling referential-integrity checks.
preferred_tables=(
  webhook_events
  strategy_presets
  strategy_setups
  paper_runners
  live_runners
  research_projects
  research_experiments
)
ordered_bases=()
for preferred in "${preferred_tables[@]}"; do
  for table in "${bases[@]}"; do
    if [[ "${table}" == "${preferred}" ]]; then
      ordered_bases+=("${table}")
      break
    fi
  done
done
for table in "${bases[@]}"; do
  found=0
  for preferred in "${preferred_tables[@]}"; do
    if [[ "${table}" == "${preferred}" ]]; then
      found=1
      break
    fi
  done
  if (( found == 0 )); then
    ordered_bases+=("${table}")
  fi
done
bases=("${ordered_bases[@]}")
echo "Load order: ${bases[*]}"

for table in "${bases[@]}"; do
  if [[ ! "${table}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "Unsafe table name from export: ${table}" >&2
    exit 1
  fi
  echo "Loading ${table}"
  psql -v ON_ERROR_STOP=1 -d "${PGDATABASE}" -c "TRUNCATE TABLE public.\"${table}\" CASCADE"
  # Map by the exported header names, not physical target-column order. The
  # additive drift migrations can change that order between source and target.
  cols="$(for f in ${work}/migration/${table}.csv.gz.?? ${work}/migration/${table}.part*.csv.gz.??; do [[ -f "${f}" ]] || continue; cat "${f}"; done | gunzip | head -n 1 | tr -d '\r' | sed 's/[^,]*/"&"/g' || true)"
  if [[ -z "${cols}" ]]; then
    echo "Missing CSV header for ${table}" >&2
    exit 1
  fi
  # Shards are byte-split gzip streams, so concatenate before decompression.
  # Each logical CSV shard also carries a repeated header; remove duplicates
  # after decompression while preserving the first header for COPY.
  printf '\\copy public."%s" (%s) FROM PROGRAM '\''for f in %s.csv.gz.?? %s.part*.csv.gz.??; do [ -f "$f" ] || continue; cat "$f"; done | gunzip | awk "NR==1 { header=\$0; print; next } \$0 != header"'\'' WITH (FORMAT csv, HEADER true)\n' \
    "${table}" "${cols}" "${work}/migration/${table}" "${work}/migration/${table}" |
    psql -v ON_ERROR_STOP=1 -d "${PGDATABASE}"
done

psql -v ON_ERROR_STOP=1 -d "${PGDATABASE}" \
  -c "INSERT INTO public.aws_migration_control (migration_id, source_prefix, object_count) VALUES ('${migration_id}', 's3://${FILES_BUCKET}/migration/', ${#bases[@]}) ON CONFLICT (migration_id) DO NOTHING"

echo "Migration ${migration_id} completed; no S3 objects were deleted or overwritten."
