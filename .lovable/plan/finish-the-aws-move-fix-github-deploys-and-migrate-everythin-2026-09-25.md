# Finish the AWS move: fix GitHub deploys and migrate everything left

## Goal
Every GitHub push deploys to AWS without failing, and every feature runs fully on AWS at https://d1f25j3whe211f.cloudfront.net, with nothing left on Lovable Cloud except a rollback copy. Trading stays paused until the final switch-on step.

## 1. Fix GitHub deploys until one succeeds
- Read the latest failed run and the AWS stack events to find the exact failing step.
- Stop the workflow depending on permissions your AWS user doesn't have (the last failure was a role-policy read). The deploy will reference the existing app roles by name, not inspect them.
- Re-run the workflow myself, and keep repeating inspect → fix → re-run until it goes green, including the health check behind CloudFront.
- If AWS refuses an action only you can grant, I'll give you one short policy change under 2,048 characters.

## 2. Migrate every remaining feature
- **Browser data screens:** any screen still reading Lovable Cloud directly will go through the app's own server instead.
- **Accounts:** create your owner account in AWS sign-in and move the owner link to it. You'll set a new password once.
- **Private files:** copy the export folder to the AWS files bucket, and switch export and snapshot downloads to use it.
- **AI features:** check they work on AWS using the stored key.
- **Webhook and manual order endpoints:** check the signatures work on AWS.
- **Schedules:** create AWS schedules for the live tick, paper tick, strategy tick and 30-minute watchdog. They start disabled.
- **Backups:** turn on daily database backup and file versioning, which are already partly set up.

## 3. Validate everything on the AWS address
- Open every page through CloudFront and check it for errors.
- Test sign-in, saving presets, the matrix, pipeline, research, optimizer, exports, the webhook, and a dry-run tick with trading off.
- Compare Shark open orders and positions with the AWS records.

## 4. Final sync and switch-on
- Copy any records written since the first migration into AWS again, then compare counts.
- Turn on paper schedules first and confirm they work.
- Live trading stays paused until you say "go live". This is the only step that needs you, because it spends real money.
- Lovable Cloud stays untouched as a rollback.

## Technical details
- Workflow: stop using `iam get-role` and pass role ARNs built from the account ID and role names. Keep `validate-template`. Use `jq` to report failed stack events on error.
- Any leftover `@/integrations/supabase/client` imports in routes and hooks will move behind `createServerFn` using the `db-admin.server` proxy.
- Storage: the S3 client uses the task role, with signed URLs for downloads.
- Scheduler: EventBridge Scheduler calls `/api/public/hooks/*` with the scheduler secret header, `State=DISABLED` at first.
- Data re-sync: the same Fargate loader, run on rows newer than the first cut, with counts compared for each table.
