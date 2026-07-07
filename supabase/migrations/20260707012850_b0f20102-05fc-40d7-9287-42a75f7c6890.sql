ALTER TABLE public.strategy_settings ALTER COLUMN session_start_ist SET DEFAULT '06:00';
UPDATE public.strategy_settings SET session_start_ist = '06:00' WHERE session_start_ist = '05:30';