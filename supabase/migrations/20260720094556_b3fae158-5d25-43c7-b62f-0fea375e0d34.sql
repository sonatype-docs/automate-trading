ALTER TABLE public.live_runners ADD COLUMN IF NOT EXISTS config_overrides jsonb;
ALTER TABLE public.paper_runners ADD COLUMN IF NOT EXISTS config_overrides jsonb;