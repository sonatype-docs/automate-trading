## Goal

Add two filter groups to the **backtest engine** and **24-hour sweep** only. Live trading rules stay untouched. Every filter is optional and off by default so existing results remain reproducible.

## Filters

### 1. HTF Bias
Skip trades that fight the higher-timeframe direction.

- **Daily EMA bias** — fetch daily candles for the symbol; compute EMA(len). Long only if session-open price > EMA, short only if <. `len` configurable (default 20).
- **Prior-day close bias** — long only if session-open price > yesterday's IST close, short only if <.
- **Weekly open bias** — long only above current week's IST open, short only below.

Each is an independent toggle. When multiple are on, ALL must agree (AND).

### 2. Setup Quality
Filter weak or extreme session candles and weak breaks.

- **Zone size (min / max)** in $ or % of price. Skip session if candle range outside band.
- **ATR regime** — Daily ATR(14) must sit inside [min, max] band (absolute $). Kills dead + spike days.
- **Break strength** — break candle must close beyond zone by ≥ N% of zone range (default 0 = off).
- **Break body ratio** — break candle body / total range ≥ X% (rejects wick-through breaks).
- **Break timing window** — break must occur within first K hours after session candle; otherwise no trade.

When a filter rejects, the day's `outcome` becomes a new value `"filtered"` (distinct from `"skipped"`) with `pnl_usd = 0` so we can audit rejection counts.

## Where it applies

- `runBacktestRange` / `simulateFromKlines` — accept new `filters` option object.
- `runSweep` — accept same object, pass through to every hourly simulation.
- Backtest Lab UI: new collapsible **"Filters"** card above the run buttons, shared by single-run backtest and 24-hour sweep.
- Live engine (`engine.server.ts`) and live rules editor: **unchanged**.

## UI

New card in `src/routes/backtest.tsx`:

```text
FILTERS  [master toggle]
├─ HTF Bias
│  □ Daily EMA bias    len [20]
│  □ Prior-day close bias
│  □ Weekly open bias
└─ Setup Quality
   □ Zone size    min [   ]  max [   ]   unit ($ | %)
   □ Daily ATR    min [   ]  max [   ]   atr len [14]
   □ Break strength   ≥ [ 0 ] % of zone range
   □ Break body ratio ≥ [ 0 ] %
   □ Break timing     within [ 0 ] hours (0 = off)
```

Backtest result view adds a **"Filtered"** counter next to `Skipped`, so we can see how many days each filter removed.

## Technical notes

- **Extra data fetch:** Daily/weekly bias needs daily klines. Fetch once per symbol per sweep (same optimization as current sweep's 1H fetch). Add `getKlinesRange(symbol, "1d", …)` call gated on whether any bias filter is on.
- **ATR regime** reuses the same daily klines, so no extra fetch.
- **Types:** add `FilterConfig` to `backtest-range.server.ts`, thread through `RangeBacktestResult.filters`, add `filtered` to `DayResult["outcome"]` union, update summary counts.
- **Server fn:** extend `BacktestRangeSchema` and `SweepSchema` with optional `filters` object (all fields optional). Backward compatible — omitted = no filtering.
- **No schema/DB changes.** Presets table stays as is; can be extended later to store filter configs alongside SL/RR.

## Out of scope (parked for a later round)

- Risk circuit breakers (max daily loss, consec losses)
- News blackout dates
- Killzone / session-overlap gating
- Wiring any of this into live sessions
- Persisting filter configs as presets

Say the word and I'll flip to build mode.
