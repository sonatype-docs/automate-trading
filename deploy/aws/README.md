# AWS production deployment

This directory contains the AWS foundation for Sydney (`ap-southeast-2`). It does not use or modify the existing `quant-db` bucket.

## Safety state

- Live and paper trading remain paused during provisioning and migration.
- The application starts with zero running tasks (`DesiredTaskCount` defaults to 0), so nothing trades on deployment.
- Trading schedules are intentionally not created yet. They are added only after data migration and paper verification pass.
- The existing deployment and database remain the rollback source.
- No old resource is deleted by this stack. Data-bearing resources are retained on stack deletion.

## Foundation

The template creates 39 resources: private S3 storage for assets, files, and backups; CloudFront with private origin access; a load-balanced container service; encrypted Multi-AZ PostgreSQL with deletion protection; Cognito; Secrets Manager entries; logs; and a health alarm. The application image is built with `Dockerfile.aws` and listens on port 3000. The load balancer checks `/api/public/health`.


## Required sequence

1. An AWS account administrator attaches `iam-bootstrap-policy.json` to the dedicated deployment identity, preferably with a permissions boundary.
2. Repeat read-only inventory to detect conflicts.
3. Build and push the image, create a CloudFormation change set from `template.yaml`, and review it before execution.
4. Populate created secrets through AWS Secrets Manager; never commit or pass private values on a command line.
5. Apply all 52 database migrations in filename order, then import the final paused export.
6. Reconcile all 28 table counts and checksums, migrate identity, and verify private files.
7. Test CloudFront, sign-in, protected data, exports, webhooks, and existing smoke tests.
8. Reconcile exchange orders and positions before enabling paper trading. Live trading needs separate approval.

## Rollback

Disable any schedules, set the container desired count to zero, and stop sending traffic to CloudFront. The source deployment and database remain unchanged until separate retirement approval.