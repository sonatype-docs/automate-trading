# AWS production deployment

This directory contains the AWS foundation for Sydney (`ap-southeast-2`). It does not use or modify the existing `quant-db` bucket.

## Safety state

- Live and paper trading remain paused during provisioning and migration.
- All schedules are created disabled.
- The existing deployment and database remain the rollback source.
- No old resource is deleted by this stack.

## Foundation

The AWS template covers private S3 storage, CloudFront, container hosting, private PostgreSQL, Cognito, Secrets Manager, monitoring, and disabled schedules. The application image is built with `Dockerfile.aws` and listens on port 3000. The load balancer checks `/api/public/health`.

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

Disable schedules and set the ECS desired count to zero. The source deployment and database remain unchanged until separate retirement approval.