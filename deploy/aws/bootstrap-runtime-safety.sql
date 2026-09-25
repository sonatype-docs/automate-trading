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
