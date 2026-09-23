# Move the complete backend to the external Supabase project

## Goal
Move the current Lovable Cloud backend to the empty Supabase project you supplied, while keeping the web app hosted by Lovable. Transfer the database structure and rows, existing users, the private storage bucket and files, access policies, database functions/triggers, schedules, and runtime configuration. Pause live and paper automation during the final cutover, with a few hours allowed.

## What I confirmed
- The app currently depends on 28 public tables, database functions, triggers, indexes, grants, and row-level access policies.
- The repository contains 52 ordered SQL migrations that cover most database structure.
- Actual table rows are not stored in the repository and require a separate export/import.
- Existing authentication identities are referenced by database rows, so user IDs must be preserved where possible.
- One private storage bucket and its objects must be transferred separately.
- Five public automation endpoints exist for live ticks, paper ticks, strategy ticks, the live watchdog, and manual placement. Their schedules are not represented in the repository migrations.
- Shark Exchange, TradingView, and Lovable AI secrets are independent of the database and must remain server-only.
- The current public database key is also used to authorize scheduled endpoint calls; this must be replaced with a dedicated secret during migration rather than carrying that pattern forward.

## Migration plan

### 1. Establish secure access and take inventories
- Connect the supplied destination project to the workspace using its administrator-authorized connection.
- Collect the destination project URL, publishable key, service-role key, and database connection credentials through secure secret entry; no credentials will be pasted into chat or committed to files.
- Capture source and destination inventories: tables, row counts, functions, triggers, grants, policies, extensions, users, storage objects, and active schedules.
- Confirm the destination is empty before any destructive or schema-changing operation.
- Identify the current owner account and all user-ID references that must survive migration.

### 2. Prepare a reversible cutover
- Create a dated full backup/export of the source database and private storage manifest.
- Record baseline row counts and checksums for high-value trading tables, especially trade history, runners, settings, research, and pipeline data.
- Add a dedicated random scheduler secret and update the five automation endpoints to validate it instead of using the public database key.
- Prepare destination environment values without switching the running app yet.
- Keep the source backend intact until destination validation is complete; do not disconnect Lovable Cloud early because that deletion is irreversible.

### 3. Pause trading automation safely
- Enable the trading kill switch and stop live and paper runners.
- Disable or pause all scheduled callers before the final export.
- Confirm no tick, watchdog, or webhook write is still in flight.
- Record open exchange orders and positions. Database migration will not alter exchange positions; they must be reconciled explicitly before resuming.

### 4. Recreate the destination structure
- Apply the 52 existing migrations in their original order and exact form.
- Compare the resulting destination schema against the live source, then add a final migration only for verified drift not represented in the repository.
- Recreate required extensions, grants, row-level policies, functions, triggers, indexes, and sequences.
- Regenerate database types from the destination after the schema matches.
- Run database security and policy checks before importing application data.

### 5. Migrate users and ownership
- Use the strongest supported authentication export/import path available from the source.
- Preserve user UUIDs so owner and user-owned records retain their relationships.
- If password hashes cannot be exported from Lovable Cloud, migrate identities with the same verified emails and require a password reset; no passwords will be requested or handled manually.
- Restore the owner record only after the matching destination user exists, preventing another account from claiming ownership.
- Reconfigure allowed URLs and any enabled email or social sign-in providers for the published and preview domains.

### 6. Transfer all database rows
- Export source rows after automation is paused.
- Import in dependency order, preserving primary keys, timestamps, arrays, JSON, and foreign-key relationships.
- Handle large trade archives with a streamed/chunked transfer rather than browser payloads.
- Reset sequences where applicable.
- Compare source and destination row counts plus targeted checksums; investigate every mismatch before cutover.

### 7. Transfer private files
- Recreate the private `database_export_18_07_26` bucket with equivalent privacy settings and policies.
- Copy every object while preserving paths, content types, and metadata where supported.
- Compare object counts and byte totals, then test an authenticated download.

### 8. Recreate automation and external integrations
- Recreate the live tick, paper tick, strategy tick, and watchdog schedules using the published app’s stable URL and the dedicated scheduler secret.
- Preserve the requested 30-minute watchdog frequency; verify the actual intended cadence of the other tick jobs from the source before recreating them.
- Keep the existing Shark Exchange, TradingView, and Lovable AI credentials unless you request rotation.
- Verify TradingView webhook delivery and ensure no scheduler remains pointed at the old backend configuration.

### 9. Rebind the Lovable-hosted app
- Switch browser and server database configuration to the destination URL and keys through supported project connection/settings, not committed `.env` values.
- Rebind runtime secrets needed by server operations.
- Keep Lovable AI enabled.
- Validate sign-in, authenticated server calls, dashboard reads, preset saves, storage access, and all trading/research pages against the destination.

### 10. Validate and resume cautiously
- Run read/write checks across all 28 tables and verify access is denied correctly for unauthenticated users.
- Compare critical settings, runner definitions, open/closed trades, research snapshots, and archive counts.
- Run one paper tick and watchdog cycle first.
- Reconcile open Shark positions/orders against destination records.
- Resume paper automation, observe a successful cycle, then resume live automation.
- Monitor logs and database writes through at least one complete scheduled cycle.

### 11. Retire the old backend only after acceptance
- Keep the source backup and old backend available for a defined rollback window.
- After you approve the migrated system, disable old schedules and webhooks permanently.
- Disconnect/delete Lovable Cloud only as the final explicit step. This is irreversible and permanently removes its database, authentication, storage, and functions.

## Secure items needed after approval
You said the credentials are ready. I will request these through secure forms or the supported connection screen when each is needed:
- Destination database connection credential/password.
- Destination publishable key.
- Destination service-role key.
- Administrator authorization for the destination project.

Existing Shark Exchange, TradingView, and Lovable AI secrets are already present and will not be requested again unless validation shows they must be rotated.

## Acceptance criteria
- All source tables, rows, functions, triggers, grants, policies, users, and private files are accounted for in the destination.
- Existing owner access works and user-linked rows retain their owners.
- Published and preview apps read and write only to the destination.
- Paper and live automations are not duplicated and resume only after reconciliation.
- Scheduled checks and TradingView callbacks succeed with the new dedicated authentication secret.
- Source Lovable Cloud remains untouched until you explicitly approve irreversible retirement.
