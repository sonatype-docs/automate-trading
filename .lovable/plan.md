# Run the whole app on AWS, including data and sign-in

## Goal
Serve the full app at https://d1f25j3whe211f.cloudfront.net. It will use the AWS database (already loaded: 294,191 archive trades and every other table, with counts verified) and AWS sign-in (Cognito). Every page, report, backtest, runner and trading control should work the same as it does today. Trading stays paused until you approve turning it back on.

## Current state
- The AWS infrastructure is built: CloudFront, load balancer, container service (0 running copies), database, Cognito, private storage, and secrets.
- The app still reads data and signs people in through Lovable Cloud. About 25 source files depend on it: most of the server logic, 2 sign-in-protected features, and 3 browser screens.

## Phases

### 1. Data access layer (server)
- Add one server-only database module that connects to the AWS database with a connection pool, using the injected `DATABASE_*` values over TLS.
- Build a small query helper with the same chained shape the code already uses (`from().select().eq().order().limit().insert().update().upsert().delete()`, plus the 2 database functions), so existing files change by one import instead of being rewritten.
- Switch all server files from the Lovable Cloud admin client to this helper. Trading, runner, watchdog, pipeline, research and export logic stays as it is.

### 2. Browser data calls
- Move the 3 screens that read the database directly in the browser behind server functions, so the browser never talks to the database.

### 3. Sign-in on Cognito
- Replace the Lovable Cloud sign-in screens with Cognito email/password sign-in, using its standard browser library.
- Check Cognito tokens on the server, replacing the current sign-in check. Keep the single-owner rule: only the owner account can use protected actions. Existing Lovable Cloud passwords can't be exported, so you'll set a new password once. The owner link will be updated to the new account.

### 4. Build and runtime settings
- Add the Shark exchange, TradingView webhook, AI and scheduler values to AWS Secrets Manager, entered through a secure form rather than chat.
- Update the container build so it doesn't need Lovable Cloud settings.
- Deploy with 1 running copy and confirm the health check passes behind CloudFront.

### 5. Schedules (created paused)
- Add EventBridge Scheduler jobs for live tick, paper tick, strategy tick and the 30-minute watchdog, calling the protected endpoints with the scheduler secret. They are created disabled.

### 6. Validation
- Open every page through the AWS address and check it for errors.
- Test sign-in, saving presets, pipeline runs, research pages, exports, the webhook with its signature, and a dry-run tick with trading off.
- Compare Shark open orders and positions against the migrated records.
- Final data sync: run the copy again just before cutover so nothing written in the meantime is lost.

### 7. Cutover (needs your approval)
- Turn on paper schedules first, then live trading only after you say so.
- Lovable Cloud stays untouched as a rollback until you approve retiring it.

## Cost
Running 1 container copy adds about USD 15–20/month on top of the database and load balancer, which already bill.

## Technical details
- Driver: `pg` (node-postgres) in `src/lib/db.server.ts`. Queries use parameters only, never string-built SQL.
- The query helper lives in `src/lib/db-query.server.ts`. Its API is a subset of the Supabase JS client, typed against the existing `Database` types.
- Auth: `amazon-cognito-identity-js` in the browser. On the server, `aws-jwt-verify` checks tokens against the user pool (`ap-southeast-2_3CQ298jr5`), attached as middleware in `src/start.ts`.
- The build target stays as `build:aws` (Nitro node-server). The `VITE_SUPABASE_*` dependency is removed from the client bundle.
- The Lovable preview and published site keep working until cutover, controlled by an environment switch (`DATA_BACKEND=aws|cloud`).
