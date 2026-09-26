-- Idempotent runtime safety bootstrap.
-- Safe to run on every migration image. Does not touch trade data.

CREATE TABLE IF NOT EXISTS public.trading_controls (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  global_live_enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'DISABLED' CHECK (mode IN ('DISABLED','PAPER','LIVE')),
  kill_switch boolean NOT NULL DEFAULT true,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trading_controls ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE public.trading_controls ADD COLUMN IF NOT EXISTS kill_switch boolean;
UPDATE public.trading_controls
SET global_live_enabled = false,
    mode = 'DISABLED',
    kill_switch = true,
    reason = 'Disabled by migration safety control',
    updated_at = now()
WHERE id = true;

INSERT INTO public.trading_controls (id, global_live_enabled, mode, kill_switch, reason)
VALUES (true, false, 'DISABLED', true, 'Disabled by default')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.trading_controls TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY,
  cognito_sub text NOT NULL UNIQUE,
  email text,
  is_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS cognito_sub text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS users_cognito_sub_idx
  ON public.users (cognito_sub);

CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner_idx
  ON public.users ((is_owner))
  WHERE is_owner = true;

GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated, service_role;

-- Audited manual order intents. The unique idempotency key prevents retries
-- from creating duplicate broker orders. Live trading remains fail-closed.
CREATE TABLE IF NOT EXISTS public.manual_order_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.users(id),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','rejected','submitted','failed')),
  broker_order_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manual_order_intents_user_created_idx
  ON public.manual_order_intents (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.manual_order_intents TO authenticated, service_role;

-- Owner-scoped metadata for private S3 files. Existing trade objects are not
-- migrated or rewritten; new application files use a separate key prefix.
CREATE TABLE IF NOT EXISTS public.private_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  s3_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  checksum text,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','complete')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS private_files_user_created_idx
  ON public.private_files (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.private_files TO authenticated, service_role;

-- Async isolated compute queue state.
-- Jobs are user-scoped and contain only research inputs/results, never trade secrets.
CREATE TABLE IF NOT EXISTS public.compute_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS compute_jobs_user_created_idx
  ON public.compute_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS compute_jobs_status_created_idx
  ON public.compute_jobs (status, created_at ASC);

ALTER TABLE public.compute_jobs
  ADD COLUMN IF NOT EXISTS result_s3_key text,
  ADD COLUMN IF NOT EXISTS result_size_bytes bigint;

GRANT SELECT, INSERT, UPDATE ON public.compute_jobs TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.pipeline_dataset_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  snapshot_name text NOT NULL,
  manifest_s3_key text,
  row_count bigint NOT NULL DEFAULT 0,
  part_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','complete','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, snapshot_name)
);
CREATE INDEX IF NOT EXISTS pipeline_dataset_exports_user_idx
  ON public.pipeline_dataset_exports (user_id, created_at DESC);
