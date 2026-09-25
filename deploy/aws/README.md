# AWS production deployment

This directory contains the AWS runtime foundation for Sydney (`ap-southeast-2`). The application uses existing production data-bearing resources rather than recreating them.

## Current runtime architecture

```
CloudFront
  -> internet-facing ALB
      -> ECS Fargate application task (1 by default)
          -> private RDS PostgreSQL
          -> Cognito
          -> Secrets Manager
          -> protected S3 buckets
```

The runtime stack is `shark-auto-trader-runtime`. The protected production buckets are:

- `shark-auto-trader-files-438456517782-ap-southeast-2`
- `shark-auto-trader-backups-438456517782-ap-southeast-2`

The existing 280K+ trade export and other migration data in those buckets must never be deleted, overwritten, or force-removed as a deployment recovery step.

## Trading safety

- `SchedulePaper`, `ScheduleStrategy`, `ScheduleLive`, and `ScheduleWatchdog` default to `false`.
- The normal application deployment workflow explicitly keeps all four schedules disabled.
- The scheduler uses transaction-scoped PostgreSQL advisory locks so multiple ECS tasks cannot execute the same scheduled job concurrently.
- A DB-backed `trading_controls` row gates NEW live exposure. Missing or unreadable control state fails closed.
- Reduce-only exit orders remain allowed so disabling new live entries does not trap an existing position.
- `live_trades` already has a unique `(runner_id, dedup_key)` constraint; scheduler locking plus that constraint provide the current duplicate-signal protection.
- Never enable live trading as part of a deployment or migration operation.

## Health and readiness

- `/api/public/health` is intentionally cheap and is used for ECS/ALB liveness.
- `/api/public/ready` performs a deeper operational check: database connectivity, required runtime environment, and required core table presence.
- The deployment workflow waits for ECS stability and then verifies `/api/public/ready`.

## Database

The application uses a small PostgreSQL connection pool tuned for the current RDS micro instance. `PGPOOL_MAX` is supported and is clamped to a safe range.

RDS is the transactional system of record. Heavy quantitative analytics should move toward S3/Parquet/DuckDB rather than large scans against the transactional database.

## Deployment and migration separation

The normal `.github/workflows/deploy-aws.yml` workflow builds the application image and deploys the runtime. It does **not** run the S3-to-PostgreSQL migration task.

Use `.github/workflows/migrate-aws.yml` manually for schema/data migration work. It:

1. Verifies the protected buckets, database, and database secret.
2. Builds or reuses an immutable migration image.
3. Runs the existing migration task definition.
4. Requires exit code `0`.
5. Never deletes or overwrites S3 objects.

## CloudFront

The current distribution keeps `app-origin` as the default origin. The previous `assets/*` routing is intentionally not restored because the application currently serves its built assets from the ECS app origin.

CloudFront compression is enabled on the default behavior. More aggressive static-asset caching should only be added after the actual build asset paths are verified.

## Infrastructure safety

Do not:

- delete or force-remove the protected S3 buckets
- recreate the production RDS instance to recover from a deployment failure
- delete Cognito or Secrets Manager resources as rollback cleanup
- rebuild the existing VPC just to change runtime topology
- run destructive CloudFormation recovery
- deploy with live schedules enabled

The repository workflow is designed to fail rather than destroy existing production resources when a failed CloudFormation stack still owns non-deleted resources.
