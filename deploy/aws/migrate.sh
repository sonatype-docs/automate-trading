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
work=/work
rm -rf "${work}"
mkdir -p "${work}/migration"
aws s3 cp "s3://${FILES_BUCKET}/migration/" "${work}/migration/" --recursive

for sql in schema.sql drift.sql; do
  if [[ ! -f "${work}/migration/${sql}" ]]; then
    echo "Missing migration/${sql}" >&2
    exit 1
  fi
  psql -v ON_ERROR_STOP=1 -f "${work}/migration/${sql}"
done

psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.aws_migration_control (
  migration_id text PRIMARY KEY,
  source_prefix text NOT NULL,
  object_count integer NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
SQL

mapfile -t bases < <(
  find "${work}/migration" -maxdepth 1 -type f -name '*.csv.gz.*' -printf '%f\n' |
    sed -E 's/(\.part[0-9]+)?\.csv\.gz\.[^.]+$//' |
    sort -u
)

if (( ${#bases[@]} == 0 )); then
  echo "No compressed CSV exports found under migration/" >&2
  exit 1
fi

for table in "${bases[@]}"; do
  if [[ ! "${table}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "Unsafe table name from export: ${table}" >&2
    exit 1
  fi
  echo "Loading ${table}"
  psql -v ON_ERROR_STOP=1 -d "${PGDATABASE}" -c "TRUNCATE TABLE public.\"${table}\" CASCADE"
  printf '\\copy public."%s" FROM PROGRAM '\''cat %s*.csv.gz.?? | gunzip'\'' WITH (FORMAT csv, HEADER true)\n' \
    "${table}" "${work}/migration/${table}" |
    psql -v ON_ERROR_STOP=1 -d "${PGDATABASE}"
done

psql -v ON_ERROR_STOP=1 -d "${PGDATABASE}" \
  -v migration_id="${migration_id}" \
  -v object_count="${#bases[@]}" \
  -c "INSERT INTO public.aws_migration_control (migration_id, source_prefix, object_count) VALUES (:'migration_id', 's3://${FILES_BUCKET}/migration/', :'object_count'::integer) ON CONFLICT (migration_id) DO NOTHING"

echo "Migration ${migration_id} completed; no S3 objects were deleted or overwritten."
