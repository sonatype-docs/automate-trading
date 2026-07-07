# Add All 5 Gold Strategies to Backtesting Dashboard

Build all 5 researched strategies into the backtest dashboard as fully configurable modules. Backtest-only scope — no live-engine or order-placement changes. Every knob exposed in the UI so you can tune freely.

## Strategies being added

1. **Multi-Session ORB** (Asian / London / NY, per-session config)
2. **Asian Liquidity Sweep + Reversal** (new setup engine)
3. **ICT Silver Bullet — NY AM kill zone** (new setup engine, MSS + FVG)
4. **D1 EMA regime gate** (filter)
5. **ATR squeeze pre-session filter** (filter)

Each is independently toggleable and combinable. Filters (4, 5) apply to any active strategy. Strategies (1, 2, 3) can run individually or side-by-side in one backtest run.

## Architecture

### Data model — `src/lib/strategy/filters.ts` + new `strategies.ts`

Extend `FiltersZod`:

```
htf.ema_bias_enabled, htf.ema_bias_fast (default 21), htf.ema_bias_slow (default 50), htf.ema_bias_mode ('gate_by_slow' | 'gate_by_cross')
quality.atr_squeeze_enabled, quality.atr_squeeze_lookback (default 20), quality.atr_squeeze_ratio (default 0.7)
```

New `StrategiesZod` (top-level in backtest request):

```
orb: {
  enabled, sessions: Array<{
    id, label, session_start_ist, range_minutes,
    range_source: 'self' | 'asian',
    entry: EntryConfig (mode/depth/sl_depth/adaptive/retest),
    rr, sl_risk_usd_override?, trail_enabled, trail_activate_r, trail_step_r,
    require_range_consolidation_bars (yulz008 idea, default 0 = off)
  }>
}
sweep: {
  enabled,
  levels: {
    pdh_pdl, asian_hl, equal_hl (eps_atr_pct), round_numbers (grid_usd: 10|25|50)
  },
  min_wick_pips, sl_buffer_pips, rr1, rr2, tp1_partial_pct,
  timeframe ('m30' | 'h1'),
  session_window_ist? { start, end }  // optional restriction, default London 12:30-15:30
}
silver_bullet: {
  enabled,
  window_ist { start (default 19:30), end (default 20:30) },
  execution_tf ('1m' | '3m' | '5m'),
  context_tf ('15m'),
  fvg_min_pips, mss_lookback_bars,
  premium_discount_split_pct (default 50),
  rr (default 3), sl_buffer_pips
}
```

Every field has a sensible default; UI shows current value with reset-to-default per field.

### Server engine — new files under `src/lib/strategy/`

- `levels.server.ts` — level scanners: PDH/PDL, Asian H/L, equal-highs/lows (H1 lookback + ATR% epsilon), round-number ladder
- `sweep.engine.server.ts` — sweep detection + reversal setup generator
- `silver-bullet.engine.server.ts` — MSS detector, FVG detector, premium/discount validator, retest-entry generator
- `multi-session-orb.server.ts` — wraps existing ORB logic to loop over N session configs per day
- `backtest-range.server.ts` — extended to accept `StrategiesConfig`, produce **per-strategy** result blocks plus a combined block

Result shape adds `strategy: 'orb' | 'sweep' | 'silver_bullet'` and `session_id?` to every trade, so existing cohort analytics (body / OR-size / break-distance / weekday / TP-target / MAE) automatically breakdown by strategy without new code.

Combined-run stats block: PF / WR / avg R / max DD / expectancy / Sharpe per strategy, plus overlap analysis (same-day double-fires).

### UI — `src/routes/backtest.tsx`

New collapsible cards inside the backtest form, in this order:

1. **Strategies** (master toggles + expand)
   - **ORB Sessions** card
     - Add/remove sessions (Asian preset, London preset, NY preset, custom)
     - Per-session: start time, range minutes, range source, full entry config (reuse existing entry inputs), per-session RR + trail overrides, consolidation-bars filter
   - **Liquidity Sweep** card
     - Level toggles (PDH/PDL, Asian H/L, equal H/L with ε slider, round-number grid select)
     - Sweep params: min wick pips, SL buffer, RR1/RR2, TP1 partial %, timeframe, optional session-window restriction
   - **Silver Bullet** card
     - Window start/end (IST), execution TF, context TF, FVG min pips, MSS lookback, premium/discount split %, RR, SL buffer

2. **Filters** (existing card, extended)
   - New **HTF EMA regime gate** row: enable, fast len, slow len, mode dropdown
   - New **ATR squeeze** row under existing ATR block: enable, lookback, ratio slider (0.3–1.0)

3. **Results view** (extended)
   - **Strategy comparison** table at top when >1 strategy active: side-by-side PF / WR / trades / avg R / max DD / expectancy
   - **Per-strategy tabs** below: equity curve, trades table, cohort breakdowns, MAE — filterable by strategy chip
   - Existing cohort dimensions apply automatically to each strategy
   - Trades table gains **Strategy** and **Session** columns; chip filter on strategy/session

4. **Presets** (extended)
   - Presets already exist for symbol/risk/RR; extend `strategy_presets` schema to optionally store a full `strategies + filters` blob. Existing presets keep working (blob is nullable).

### Migration

- `strategy_presets`: add `config_json jsonb` (nullable). GRANTs unchanged; RLS unchanged.
- No changes to `strategy_setups` / `strategy_sessions` (backtest-only scope).

### Sweeps (Hour + Entry-Zone grids)

Both existing sweep tools gain a **Strategy** selector. When a non-ORB strategy is selected, irrelevant axes are hidden (e.g. entry-depth grid disabled for Silver Bullet, replaced with FVG-min-pips / MSS-lookback grid).

## Explicitly out of scope

- Live engine, order placement, Shark client — untouched. Live still runs current single-ORB path.
- News/economic-calendar integration — separate infra.
- RL / ML models — infrastructure cost >> data.
- No changes to `src/integrations/supabase/*` (auto-gen).

## Verification

- Typecheck clean.
- Run backtest with each strategy alone on last 90 days → each produces trades and stats.
- Run all 3 strategies together → strategy comparison table renders, cohort tabs switch cleanly, filter chips work.
- Toggle EMA gate + ATR squeeze on ORB-only run → trade count drops, expectancy stats update.
- Save + reload a preset with full config blob → all fields restore.

## Technical notes

- All new engines live in `*.server.ts` files under `src/lib/strategy/` so they stay off the client bundle.
- Zod validators mirror the config on the server; UI uses shared types via `z.infer`.
- Level scanners and FVG detection are pure functions over kline arrays — trivially unit-testable, cheap to run inside the existing day-walk loop.
- Multi-strategy result blob rounded-tripped through `JSON.parse(JSON.stringify(...))` before return (existing pattern) to keep Seroval happy.
- Kline data requirements: sweep needs H1 (already fetched), Silver Bullet needs 1m/3m for execution + 15m for context. Add fetch to existing kline pipeline; cache per-day like today.

Approve to build all of this in one pass, or say which strategies/filters to defer.
