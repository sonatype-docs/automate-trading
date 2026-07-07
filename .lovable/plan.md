# TradeZella-style Rebuild

## Design system

Rewrite `src/styles.css` with a real two-mode token set. Light is default (`:root`), dark under `.dark`. Semantic tokens only — no hardcoded colors in components.

- **Accent**: violet `#8b5cf6` (primary), long `#22c55e`, short `#ef4444`, warning amber, info sky.
- **Surfaces**: light = off-white `#f8fafc` bg, white cards, slate borders. Dark = `#0f0f17` bg, `#16161f` cards, subtle violet-tinted borders.
- **Typography**: Inter (UI) + JetBrains Mono (numbers). Add `@fontsource/inter` and `@fontsource/jetbrains-mono`.
- **Motion**: 150–250ms ease-out on hover/active, `transition-colors` globally on interactive surfaces, `animate-fade-in` on page mount, subtle `scale-[1.01]` on card hover.
- **Radii/shadows**: `--radius: 0.75rem`, soft elevation shadows via `color-mix` for both modes.

## Theme toggle

- New `src/components/theme-provider.tsx` — reads `localStorage("theme")` with `system` default, applies `.dark` on `<html>`, exposes `useTheme()`.
- Mount provider in `__root.tsx` around `<Outlet />`. Add a no-flash inline script to `RootShell` `<head>` that sets the class before hydration.
- `src/components/theme-toggle.tsx` — Sun/Moon/Monitor icon button in the top bar.

## App shell (sidebar layout)

Introduce a persistent shell so every route shares nav + top bar:

- `src/components/app-sidebar.tsx` using shadcn `Sidebar` (`collapsible="icon"`), items: Dashboard, Journal, Backtest, Pending Orders, Docs, Settings. Active-route highlight via `useRouterState`.
- `src/components/app-shell.tsx` wraps children with `SidebarProvider` + top bar (breadcrumb, search, theme toggle, run/paused status pill).
- Wrap `<Outlet />` in `__root.tsx` with `AppShell`. Remove per-page ad-hoc headers/back buttons.

## Dashboard (`/`) — TradeZella-style

Replace current index with a grid of widgets:

- **KPI tiles**: Net PnL, Win rate, Profit factor, Avg win/loss, Expectancy, Total trades, Best/Worst day, Current streak.
- **Equity curve**: `recharts` area chart, cumulative PnL over selected range.
- **PnL calendar heatmap**: month grid, cells colored by daily PnL, click → filter journal to that day.
- **Win/Loss donut** + **R-multiple histogram**.
- **Recent trades** table (last 10) with side badges, PnL, R.
- **Live status card**: engine on/off, open positions, pending orders count (links to `/pending-orders`).
- Date-range picker (7D / 30D / 90D / YTD / custom) in top bar; drives all widgets.

## Journal (`/journal`) — advanced

- Filterable, sortable trade table: symbol, side, entry/exit, qty, PnL, R, duration, tags, setup, session, mistakes.
- Per-trade drawer: notes (markdown), tags multi-select, screenshots (Supabase storage), mistakes checklist, custom fields.
- Bulk tag/edit, CSV export.
- Saved filter presets (per user, persisted in DB).

## Analytics (`/analytics`) — new route

- Drawdown curve, rolling win rate, R-multiple distribution.
- Breakdowns: by symbol, by day-of-week, by hour/session, by setup tag, by side.
- Win rate vs profit-factor scatter per tag.

## Reports (`/reports`) — new route

- Daily / weekly / monthly summary cards with mini-charts.
- Exportable PDF-friendly view (print CSS).

## Other polish

- Replace ad-hoc `text-emerald-*` / `text-red-*` in existing pages (`pending-orders.tsx`, `backtest.tsx`, `settings.tsx`) with `text-long` / `text-short` tokens.
- Add page transition wrapper (`animate-fade-in` on route change key).
- Consistent empty states, skeleton loaders for all Query reads.
- Toaster styled to theme.

## Data model additions (Supabase)

- `trades` extensions: `tags text[]`, `notes text`, `mistakes text[]`, `setup text`, `session text`, `screenshot_urls text[]`, `r_multiple numeric`.
- `journal_filter_presets` table (user_id, name, filter_json), RLS + grants.
- Storage bucket `trade-screenshots` (private, per-user path).
- Migration adds columns/table, backfills `r_multiple` from existing PnL where possible.

## Technical notes

- Charts: `recharts` (already ecosystem-friendly), no new heavy deps.
- Icons: keep `lucide-react`.
- Server data: keep `createServerFn` pattern; add aggregation fns (`getDashboardStats`, `getEquityCurve(range)`, `getCalendarPnL(month)`, `getAnalyticsBreakdowns(range)`).
- All new server fns use `requireSupabaseAuth` and are called from components via `useServerFn` + `useQuery` (not public-route loaders).
- No changes to auto-generated Supabase files or `src/routeTree.gen.ts`.

## Out of scope

- No changes to trading/engine logic, order placement, or exchange client.
- No new auth flows.

## Build order

1. Tokens + fonts + theme provider + toggle.
2. App shell + sidebar; migrate existing pages into it.
3. Dashboard widgets + aggregation server fns.
4. Journal upgrades + schema migration + storage bucket.
5. Analytics + Reports routes.
6. Polish pass: transitions, empty states, skeletons, color-token cleanup.
