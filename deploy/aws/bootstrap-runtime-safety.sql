-- Idempotent runtime safety bootstrap.
-- Safe to run on every migration image. Does not touch trade data.

CREATE TABLE IF NOT EXISTS public.trading_controls (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  global_live_enabled boolean NOT NULL DEFAULT false,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.trading_controls (id, global_live_enabled, reason)
VALUES (true, false, 'Disabled by default')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.trading_controls TO authenticated, service_role;


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

GRANT SELECT, INSERT, UPDATE ON public.compute_jobs TO authenticated, service_role;
