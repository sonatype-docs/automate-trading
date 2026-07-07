## Goal

Increase filled setups and net P&L via a bigger strategy engine upgrade. Ship in 4 phases so each is testable.

Backwards compatible throughout — all defaults reproduce today's behavior.

---

## Phase 1 — Tunable entry mechanics + missed-trade analytics

### Schema (`strategy_settings`)

```
entry_mode                text     'fib' | 'retest' | 'market' | 'adaptive'   default 'fib'
entry_depth_pct           numeric  0.00–0.50    default 0.25
sl_depth_pct              numeric  0.10–1.00    default 0.75  (must > entry_depth_pct)
adaptive_strong_break_pct numeric  default 30   (>= this % beyond zone = shallow entry)
adaptive_shallow_depth    numeric  default 0.10
adaptive_deep_depth       numeric  default 0.35
retest_sl_r               numeric  default 0.5   (SL distance in R for retest mode)
```

### Entry logic

- **fib** — today's behavior, but with tunable depths (long: `entry = zone_high - range*entry_depth`, `sl = zone_high - range*sl_depth`).
- **retest** — entry at the broken zone edge (long: `entry = zone_high`), SL a fixed `retest_sl_r × range` away.
- **market** — no limit; enter at market on the 1h break candle close. `sl` still from `sl_depth_pct` for risk sizing.
- **adaptive** — measure `(break_close - zone_high) / range * 100`. If ≥ `adaptive_strong_break_pct` → shallow entry, else deep entry.

Wire through: `engine.server.ts`, `backtest.server.ts`, `backtest-range.server.ts`, `sweep.server.ts`, `strategy.functions.ts`.

### Sweep expansion

New RPC `runEntryZoneSweep({ entryDepths[], slDepths[], modes[] })` returns a grid: `{ mode, entry_depth, sl_depth, trades, fill_rate, win_rate, net_pnl, expectancy, avg_fee_per_trade }`.

Optimize on **net** (after fees), not gross.

### Missed-trade analytics (new)

Per backtest day already knows `armed_no_trigger`. Add:

- `closest_approach_r` — how close price got to the entry, in R units.
- New "Missed setups" section in `/journal` and `/backtest`: count, closest-approach histogram, and "would-have-filled if entry_depth was X%" table.
- New KPI everywhere: **fill_rate = triggered / (triggered + armed_no_trigger)**.
- New KPI: **fees / gross_pnl %** and **avg fee per trade**.

### UI

- Settings page: entry-mode dropdown + two depth sliders + adaptive knobs (collapsed section).
- Backtest page: same controls + "Entry/SL grid" heatmap card colored by net P&L.
- Journal page: "Missed setups" collapsible.

---

## Phase 2 — Miss handling: expire + re-arm

### Schema

```
entry_expiry_hours         numeric  default 0   (0 = no expiry, session-rollover as today)
rearm_enabled              boolean  default false
rearm_shallower_depth      numeric  default 0.10
```

### Live engine

- If a setup is `armed` and unfilled for `entry_expiry_hours` after `break_detected_at`: cancel exchange order, mark `expired`, then (if `rearm_enabled`) place a new limit at `entry_depth = rearm_shallower_depth` and record it as a new setup row with `parent_setup_id`.
- One retry per session per side.

### Schema addendum (`strategy_setups`)

```
parent_setup_id   uuid  nullable     (links a re-arm to its original)
expired_reason    text  nullable     ('timeout' | 'session_rollover' | 'cancelled')
```

### Backtest

Mirror the same logic against 1h bars.

---

## Phase 3 — Exit improvements

### Schema (`strategy_settings`)

```
breakeven_at_r_enabled     boolean  default false
breakeven_at_r             numeric  default 1.0
partial_tp_enabled         boolean  default false
partial_tp_r               numeric  default 1.0
partial_tp_size_pct        numeric  default 50   (% of position closed at partial)
reversal_enabled           boolean  default false   (same-day opposite-side trade)
```

### Behavior

- **Breakeven at R** — once `peakR ≥ breakeven_at_r`, snap SL to entry (never move back down).
- **Partial TP** — first bar where `high ≥ entry + partial_tp_r*risk` (long): close `partial_tp_size_pct`% at that R, mark partial P&L, remainder continues with trailing. Realized/gross P&L reporting splits.
- **Same-day reversal** — after the first setup closes with SL, keep watching that IST session for a 1h close on the *opposite* side of the zone; if it happens, arm a fresh setup with the same rules. Max 1 reversal per day.

### Schema addendum (`strategy_setups`)

```
partial_filled_at    timestamptz nullable
partial_pnl_usd      numeric     nullable
reversal_of          uuid        nullable  (link to the original losing setup)
```

Wire into live engine + backtest + journal (show partial fills as separate rows).

---

## Phase 4 — Opportunity expansion (biggest scope)

### 4a. Second session per day

`strategy_settings` gains an array of session starts:

```
session_starts_ist  text[]  default ARRAY['05:30']    (multiple, e.g. {'05:30','17:30'})
```

Live engine loops each session for the current IST date. Each session gets its own `strategy_sessions` row keyed by `(ist_date, symbol, session_start_ist)` — the sessions table needs a `session_start_ist` column added and unique constraint updated.

Backtest range iterates every session per day.

### 4b. Multi-symbol

Move single-row `strategy_settings` to a per-symbol config:

- New table `strategy_symbols` (symbol, enabled, sl_risk_usd, rr, all Phase 1–3 knobs). `strategy_settings` keeps only global knobs (kill switch analogue lives in `settings`).
- Engine tick loops symbols. Each `(symbol, ist_date, session_start_ist)` is an independent state machine.
- All `strategy_sessions` / `strategy_setups` already carry `symbol` — good.
- Journal + pending-orders + backtest UIs gain a symbol filter (already exist in journal).

Migration path: seed `strategy_symbols` from the current single-row `strategy_settings` on migration so live trading continues unbroken.

---

## Cross-cutting

- **Reports** always compute `net = gross - fees`. Sweep optimizes on net.
- **Kill switch** unchanged, still applies globally.
- **Trailing SL** unchanged; interacts with breakeven-at-R by taking the tighter of the two.
- **No changes to** Shark client, webhook handler, or auth path.

---

## Deliverable order

1. **Phase 1 migration** (7 new cols on `strategy_settings`) + engine/backtest/sweep wiring + missed-trade UI.
2. **Phase 2 migration** (3 new cols + 2 on `strategy_setups`) + live-engine expiry/re-arm + backtest mirror.
3. **Phase 3 migration** (6 new cols + 3 on `strategy_setups`) + exit logic in engine + backtest + journal partial-fill display.
4. **Phase 4 migration** (new `strategy_symbols` table + `session_start_ist` on `strategy_sessions`) + engine loop rewrite + UI multi-symbol/session pickers.

Each phase is independently shippable; you can pause between them and re-run the sweep to see which knobs actually helped before adding the next layer.

Reply "go" to start with Phase 1, or tell me to reorder / drop phases.
