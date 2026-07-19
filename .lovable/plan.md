## Load-reduction cleanup

Trim background polling and dead code across the app. Frontend + one server-side cron change; no schema changes.

### 1. Live Chart card — remove residual load
- Search for remaining imports/mounts of `src/components/live-chart-card.tsx`. If nothing renders it, delete the file and its query hooks (`getLiveChartData`, related runner-state polls). If a stray import remains, remove it.

### 2. Paper Stats / P&L Calendar / Strategy Performance — manual sync only
- Files: `src/components/paper-stats-card.tsx`, `src/components/pnl-calendar-card.tsx`, `src/components/strategy-performance-card.tsx`.
- Remove `refetchInterval`; set `staleTime: Infinity`, `refetchOnWindowFocus: false`, `refetchOnMount: false`.
- Add a small "Sync" button in each card header that calls `refetch()` and shows a spinner while pending. Show "Last synced HH:mm:ss" next to it.

### 3. paper-tick — reduce cadence
- Keep the endpoint (`src/routes/api/public/hooks/paper-tick.ts`) and engine intact.
- Update the pg_cron schedule for `paper-tick` from every minute → every 15 minutes (`supabase--insert` unschedule + reschedule).

### 4. account-snapshot — delete
- Delete `src/routes/api/public/hooks/account-snapshot.ts`.
- Grep for any UI or server-fn that calls it (balance/equity widget). Remove the widget, its query, and imports.

### 5. live-tick — adaptive skip
- Keep cron at every minute. Inside `src/lib/live-trading/tick.server.ts` short-circuit early when there are no open positions AND no pending exchange orders AND no runners armed/ready — effectively ~90–120s cadence when idle, 60s when active.

### 6. Header P&L pill — remove entirely
- Delete `src/components/header-live-pnl.tsx`.
- Remove its mount from the header (likely `src/components/app-shell.tsx`) and unused imports.

### 7. Exchange Orders card — poll active tab only
- File: `src/components/exchange-orders-card.tsx`.
- Track active tab in state. Each of the three queries: `enabled: activeTab === '<tab>' && anyRunnerRunning`. Keep existing `staleTime`.

### 8. Research page — no auto-resync on focus
- Files: `src/hooks/use-datasets-progress.ts`, `src/routes/research.tsx`.
- Ensure `useQuery` calls have `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `refetchOnMount: false` when an IndexedDB checkpoint exists. Manual **Resync** stays the only trigger.

### Technical notes
- pg_cron edits via `supabase--insert` (`cron.unschedule` + `cron.schedule`).
- No DB schema changes, no new tables, no new server functions.

### Out of scope
- Server-side ticker caching — skip unless requested.
