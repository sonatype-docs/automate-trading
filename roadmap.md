# Full AWS migration

- [x] Connect a dedicated least-privilege AWS account identity
- [x] Inventory accessible AWS account, regions, domains, and existing resources
- [x] Finalize the production region (Sydney / ap-southeast-2)
- [ ] Add a production domain later; use the AWS-generated address initially
- [x] Produce and approve the AWS architecture and migration plan
- [ ] Approve final named resources, refined monthly estimate, and provisioning blast radius
- [x] Add infrastructure-as-code, container packaging, deployment policy, and runbook
- [ ] Add/verify production trading schedules and backup plan after final data/file validation
- [x] Export and transfer the complete application database (all 29 tables, counts verified)
- [x] Deploy and validate the application on AWS while trading remains paused
- [ ] Copy/verify remaining private export files in the AWS files bucket
- [ ] Reconcile exchange orders and positions against AWS records
- [ ] Create/verify the owner Cognito account at /login
- [ ] Final incremental data re-sync
- [ ] Resume paper schedules and validate paper execution
- [ ] Resume live trading only after explicit approval
- [x] Retire the legacy hosted frontend/editor integration from the repository

## Verified AWS runtime state — 2026-09-26

- [x] main is the production release source; only the main branch remains.
- [x] Latest commit bed85c8593ad134dcc25d82e983adbd02eeb9fe0 is deployed by GitHub Actions run 149.
- [x] Run 149 completed successfully.
- [x] Application, quant-engine, and migration images were built/pushed.
- [x] CloudFormation stack shark-auto-trader-runtime updated successfully.
- [x] ECS reached stable state.
- [x] CloudFront invalidation completed.
- [x] /api/public/ready passed.
- [x] Live smoke passed health/readiness, core feature routes, and unauthenticated file API protection.
- [x] Execution Matrix routes through AWS compute_jobs and the compute worker path is in production code.
- [x] Bedrock research analysis and queued quant research workflows are merged.
- [x] Portfolio risk gating, market-data quality controls, broker adapter boundary, live Shark stream, and AWS alarms are merged.
- [x] Normal releases explicitly keep paper, strategy, live, and watchdog schedules disabled.
- [x] Legacy hosted frontend/editor build integration removed from the repository.
- [x] AWS is the only production deployment path.

## Remaining cutover work

1. Verify private export objects in the protected AWS files bucket and exercise authenticated file flows.
2. Verify the owner Cognito identity and protected server actions.
3. Reconcile exchange orders/positions with AWS records.
4. Perform the final incremental data sync and record per-table counts.
5. Enable paper schedules first and validate successful ticks.
6. Keep live schedules disabled until explicit go-live approval.
7. Keep all production releases on the AWS path; no hosted editor/runtime is part of production.

## Historical notes

The incomplete external database destination is superseded by the full AWS migration. Legacy hosted editor/preview artifacts have been removed from the source tree. Earlier deployment failures involving IAM permissions, Docker output paths, ECS service-role creation, and RDS free-plan backup settings have been repaired.
