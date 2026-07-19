DELETE FROM public.live_runners WHERE created_at < '2026-07-19 09:00:00+00';
UPDATE public.live_runners SET running = true WHERE created_at >= '2026-07-19 09:00:00+00';
DELETE FROM public.paper_runners WHERE created_at < '2026-07-19 09:00:00+00';
UPDATE public.paper_runners SET running = true WHERE created_at >= '2026-07-19 09:00:00+00';