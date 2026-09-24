# Ship the complete trading platform to AWS

## Goal
Move the website, server processing, database, authentication, private files, scheduled trading jobs, secrets, monitoring, and backups into AWS Sydney (`ap-southeast-2`). CloudFront will be the public CDN, S3 will serve static files and backups, and the existing `quant-db` bucket will remain untouched. Use the AWS-generated address until a domain is supplied.

Trading and paper automation remain paused throughout migration. Nothing old is deleted until the AWS system passes validation and receives explicit retirement approval.

## Target AWS architecture

```text
Users
  |
CloudFront + WAF
  |-- static files --> private S3 website-assets bucket
  |-- app/API ------> Application Load Balancer --> ECS Fargate (TanStack app)
                                                   |
                                                   +--> PostgreSQL on RDS
                                                   +--> Cognito authentication
                                                   +--> private S3 file storage
                                                   +--> Secrets Manager
                                                   +--> Shark / TradingView / AI services

EventBridge Scheduler --> protected app endpoints
CloudWatch --> logs, alarms, dashboards
AWS Backup --> database and file recovery
ECR + deployment workflow --> versioned application images
```

S3 alone cannot run this application's trading, scheduled, authenticated, and server-rendered features. CloudFront will therefore use S3 for static content and the containerized app for dynamic requests.

## Migration plan

### 1. Secure AWS access and inventory
- Keep the connected dedicated IAM user; never use root credentials.
- Grant temporary, least-privilege deployment access for CloudFormation, S3, CloudFront, WAF, ACM, ECR, ECS, ELB, VPC, RDS, Cognito, EventBridge Scheduler, Secrets Manager, CloudWatch, IAM PassRole, and AWS Backup.
- Restrict deployment to Sydney where the service supports regions; CloudFront, WAF, IAM, Route 53, and certificates have required global or `us-east-1` operations.
- Re-run read-only inventory before creating anything.

### 2. Add reproducible AWS deployment files
- Add infrastructure-as-code to the repository so every AWS resource is reviewable and reproducible.
- Create separate production asset, private-file, deployment, and backup buckets; do not use or modify `quant-db`.
- Configure private S3 origins, CloudFront origin access control, HTTPS, WAF, access logs, lifecycle rules, encryption, and public-access blocks.
- Package the TanStack server for ECS Fargate and route dynamic requests through an Application Load Balancer.

### 3. Build the AWS application runtime
- Adapt the current server build from the Lovable/Worker target to a container-compatible Node runtime without changing trading rules.
- Preserve every page, API endpoint, webhook, server function, live tick, watchdog, and manual-placement flow.
- Store runtime credentials only in Secrets Manager and inject them into the task at runtime.
- Add health checks, rolling deployments, automatic rollback, bounded scaling, and CloudWatch alarms.

### 4. Move database and authentication
- Provision encrypted PostgreSQL on RDS with private networking, automated backups, point-in-time recovery, and deletion protection.
- Apply all ordered database migrations, then reconcile verified source drift, grants, policies, functions, triggers, indexes, and extensions.
- Replace the browser's direct Lovable Cloud data/auth dependency with authenticated AWS app APIs backed by RDS and Cognito.
- Preserve user identity links where possible; if password hashes cannot be exported, migrate verified identities and require password reset.
- Preserve server-side authorization for ownership and roles; never trust browser-stored roles.

### 5. Transfer records and private files
- Take a new final source export after confirming automation remains paused.
- Stream rows into RDS in dependency order, preserving IDs, timestamps, JSON, arrays, and relationships.
- Compare all 28 source table counts and targeted checksums, including trading, runners, research, pipeline, settings, and archives.
- Copy private objects to the dedicated encrypted S3 file bucket; verify object count, byte totals, metadata, and authenticated download.
- Clean the failed partial external-Supabase destination only after the AWS copy is accepted; it is not part of production.

### 6. Recreate schedules and external integrations
- Recreate live tick, paper tick, strategy tick, and watchdog schedules with EventBridge Scheduler.
- Use a dedicated scheduler secret and protected server endpoints; keep the requested 30-minute watchdog cadence.
- Preserve existing Shark, TradingView, and AI credentials unless validation requires rotation.
- Add dead-letter handling and alarms without automatic resource-creation loops.

### 7. Validate before cutover
- Test CloudFront/S3 delivery, every content page, sign-in, authenticated reads/writes, private files, webhooks, and server processing.
- Run migration/security checks, backup restoration checks, and the existing live-sync smoke tests.
- Reconcile every open Shark order and position against migrated records.
- Run one paper tick and watchdog cycle, then observe paper trading before enabling live trading.
- Keep the old system available as rollback protection.

### 8. Cut over and retire safely
- Switch traffic to CloudFront only after acceptance checks pass.
- Resume paper automation first and live automation only after explicit approval.
- Monitor one complete schedule cycle and alarms.
- Remove temporary deployment permissions after provisioning.
- Retire Lovable hosting, Lovable Cloud, and the abandoned external destination only after separate explicit approval. Destruction is not part of initial deployment.

## Resources and cost impact
Expected production resources include CloudFront, four dedicated S3 buckets, WAF, ECR, ECS Fargate, an Application Load Balancer, VPC networking, RDS PostgreSQL, Cognito, EventBridge Scheduler, Secrets Manager, CloudWatch, and AWS Backup.

Initial working estimate in Sydney: **USD 120–350/month**, excluding market-data/trading-provider fees, unusually high traffic, large database growth, data transfer, and optional NAT Gateway costs. RDS, the load balancer, containers, logs, and backups continue billing while provisioned. Exact pricing will be calculated from final sizes before creation.

## Current blocker
The connected AWS identity can read S3 but AWS currently denies CloudFront, RDS, Lambda, and Route 53 inventory. No AWS resources can be provisioned until the required least-privilege deployment policy is granted. After that, a second explicit approval will identify the exact named resources, estimated monthly cost, blast radius, rollback path, and irreversible actions before creation.

## Acceptance criteria
- The complete public app is served through CloudFront with HTTPS and no public S3 access.
- All application computation, database records, accounts, files, schedules, secrets, logs, and backups run in AWS.
- All source row and object totals reconcile, and authorization remains enforced server-side.
- Trading remains paused until paper verification and exchange reconciliation pass.
- `quant-db` remains unchanged.
- Old hosting and databases remain available until separately approved for retirement.
