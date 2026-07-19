
ALTER TABLE public.live_runners
  ADD COLUMN IF NOT EXISTS direction_filter TEXT,
  ADD COLUMN IF NOT EXISTS window_start_hour_ist SMALLINT,
  ADD COLUMN IF NOT EXISTS window_end_hour_ist SMALLINT,
  ADD COLUMN IF NOT EXISTS weekdays_ist SMALLINT[];

ALTER TABLE public.paper_runners
  ADD COLUMN IF NOT EXISTS direction_filter TEXT,
  ADD COLUMN IF NOT EXISTS window_start_hour_ist SMALLINT,
  ADD COLUMN IF NOT EXISTS window_end_hour_ist SMALLINT,
  ADD COLUMN IF NOT EXISTS weekdays_ist SMALLINT[];
