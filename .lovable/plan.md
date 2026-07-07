# Backtest cohort analytics

Add post-trade segmentation to every backtest run so we can see which conditions actually produce winners — without touching entry/exit logic.

## Cohort dimensions

For each triggered trade we record:

1. **Body strength** — breakout candle body / range × 100. Bucketed by run tertiles → `low / mid / high`.
2. **Opening-range size** — session (5:30–6:30) high − low. Bucketed by run tertiles → `small / medium / large`.
3. **Break distance** — |break close − broken edge| in USD. Bucketed by run tertiles → `near / mid / far`.
4. **Weekday** — Mon…Fri (already exists; kept as-is, shown alongside new cohorts).
5. **TP target reached** — after entry, did price touch:
   - the **swing** (session extreme on the trade's side + prior-day high/low on that side, whichever is closer)
   - the **opposite liquidity** (session extreme on the opposite side + prior-day extreme on that side, whichever is closer)
   - **both**, or **neither**
   Recorded regardless of whether the trade hit TP or SL, so we can see how often each target was actually available.

Tertile edges are computed from the run itself (per-cohort, per-run), so buckets self-calibrate to symbol and period. Edges are returned in the payload for the UI tooltip.

## Data plumbing

### `src/lib/strategy/backtest-range.server.ts`
- Extend `DayResult` with: `body_pct`, `or_size_usd`, `break_distance_usd`, `swing_ref`, `opposite_ref`, `tp_target: "swing" | "opposite" | "both" | "neither" | null`.
- During the bar walk, track max favorable excursion vs `swing_ref` and `opposite_ref` to classify `tp_target`.
- After the day loop, compute tertile edges and assign each day a bucket per dimension.
- Add `summary.cohorts` = `{ body, or_size, break_distance, weekday, tp_target }`, each value = `{ buckets: Record<label, Stat>, edges?: [n, n] }` where `Stat` = `{ trades, wins, losses, win_rate_pct, total_pnl_usd, avg_pnl_usd, avg_r }`.

### `src/lib/strategy/filter-bias.server.ts` (or inline)
- Extend the daily-kline fetch to always include one extra prior day so `prev_day_high` / `prev_day_low` are available for the swing/opposite references. Fold into `DailyBiasEntry` as `prev_high` / `prev_low` (kept optional; existing HTF bias code unaffected).

### Sweeps
- `src/lib/strategy/sweep.server.ts` (`runSweep` for Hour Sweep and `runEntryZoneSweep` for the grid): each cell already runs a simulation — capture `summary.cohorts` per cell and return it alongside the existing per-cell stats. Payloads grow but stay small (5 dims × ~3 buckets × ~7 numbers).

## UI

### `src/routes/backtest.tsx`
- **New card "COHORT BREAKDOWNS"** under Results with 5 compact tables (Body, OR size, Break distance, Weekday, TP target). Columns: bucket · trades · win% · total $ · avg R. Best row per cohort highlighted. Tertile edges shown as tooltip text.
- **Clickable cohorts**: clicking a bucket sets a `selectedCohort` state `{ dim, bucket }`. When set:
  - The **trades table** filters to matching days.
  - The **equity curve** recomputes from the filtered days' `pnl_usd` (client-side cumulative sum over `ist_date`).
  - A dismissible pill above the results shows the active filter (`Body: high ×`).
  Clicking the active bucket again clears it. Cohort tables stay unfiltered so you can pivot.
- **Hour Sweep and Entry-Zone Grid**: add a "Cohort" dropdown above each table with options `Overall` (default) + one entry per dimension. When a dimension is selected, each cell renders that dimension's **best bucket** and its win% / avg R (small subscript with the bucket name). Overall keeps current behaviour.

## Out of scope

- No changes to entry rules, filters, or order execution.
- No new persisted settings; cohort UI is purely per-run.
- No CSV export of cohort tables yet — can add if useful.

## Verification

- Typecheck.
- Run one range backtest, confirm the 5 tables render, click a bucket, confirm trade list + equity update.
- Run Hour Sweep with "Cohort: Body" and confirm cells show a bucket label.
