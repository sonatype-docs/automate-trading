## Move Trading Journal to a dedicated tab

### What changes
1. **New route `/journal`** (`src/routes/journal.tsx`) — full-page Trading Journal:
   - Header nav link back to Dashboard + Pending Orders.
   - Summary strip: fills count, wins/losses, win rate, gross P&L, fees, net realized P&L, current equity, today's P&L, net deposits.
   - **Past trades table** (from Shark `tradeHistory` via `getExchangeAccount`) — all historical fills, newest first, with Time, Symbol, Side, Qty, Price, Fee, Realized P&L, Running Equity. Includes filters: symbol dropdown, side (BUY/SELL/all), date range, and closing-fills-only toggle. CSV export button.
   - **Upcoming / open orders section** (from `getPendingSharkOrders`) — pending Shark orders (Order ID, Symbol, Side, Status, Price, Qty, Filled, SL, TP) so upcoming planned trades show alongside history. Auto-refreshes every 10s.
   - **Open positions section** (from account snapshot `openPositions`) — current live positions with entry, mark, qty, unrealized P&L.
   - Reuses the same computation logic already in `src/routes/index.tsx` (parseTime, tradeFills, pnlTrades, equity curve) — extracted inline into the new route so the dashboard stays untouched functionally.

2. **Dashboard (`src/routes/index.tsx`)**:
   - Remove the `TRADING JOURNAL` Card block (lines ~436–498).
   - Add a "Journal" button in the header nav (next to "Pending Orders").

3. **No backend changes** — all data already available via `getExchangeAccount` and `getPendingSharkOrders`.

### Technical notes
- New route auto-registers via TanStack Router file-based routing; `routeTree.gen.ts` regenerates on dev.
- CSV export = client-side blob download, no dependency.
- Equity curve mini-chart (recharts, already installed) at the top of the page.

Confirm and I'll build it.