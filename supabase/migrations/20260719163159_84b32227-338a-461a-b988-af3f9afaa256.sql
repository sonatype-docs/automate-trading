DELETE FROM public.live_trades
WHERE runner_id IN (
  SELECT id FROM public.live_runners
  WHERE strategy_preset = 'liquidity_sweep_long'
);

DELETE FROM public.live_runners
WHERE strategy_preset = 'liquidity_sweep_long';