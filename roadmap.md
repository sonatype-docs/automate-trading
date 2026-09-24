# Full AWS migration

- [x] Connect a dedicated least-privilege AWS account identity
- [x] Inventory accessible AWS account, regions, domains, and existing resources (read-only; blocked services recorded)
- [x] Finalize the production region (Sydney / ap-southeast-2)
- [ ] Add a production domain later; use the AWS-generated address initially
- [x] Produce and approve the AWS architecture and migration plan
- [ ] Approve the final named resources, refined monthly estimate, and provisioning blast radius
- [x] Add infrastructure-as-code, container packaging, deployment permission policy, and runbook (`deploy/aws/`, `Dockerfile.aws`)
- [ ] Add trading schedules and backup plan after data migration and paper verification

- [x] Export and transfer the complete application database (all 29 tables, counts verified; private files pending)
- [ ] Deploy and validate the application on AWS while trading remains paused
- [ ] Reconcile exchange orders and positions; resume paper, then live trading
- [ ] Retire Lovable hosting and the old backend only after explicit approval

## Superseded destination

- The incomplete external Supabase restore is superseded by the requested full AWS migration. Do not resume or retire anything until AWS validation succeeds.

## AWS decisions and blockers

- Region: Sydney (`ap-southeast-2`).
- Existing `quant-db` bucket: leave untouched; create dedicated deployment and backup buckets.
- Domain: not provided; use the AWS-generated address until a domain is supplied.
- Connected IAM user can list S3 but is denied CloudFront, RDS, Lambda, and Route 53 inventory. Provisioning cannot begin until least-privilege deployment permissions are granted.

## Previous external backend migration

- [x] Inventory source schema, auth, storage, and running automation
- [x] Create a private backup of the complete public schema and data
- [x] Validate destination database access and confirm it is empty
- [x] Pause automation and capture final source checksums
- [ ] Restore schema, data, and private storage to the destination
- [ ] Reconfigure authentication and application database bindings
- [ ] Recreate schedules with dedicated scheduler authentication
- [ ] Validate data, access rules, storage, and paper/live safety flows
- [ ] Resume paper, then live automation after reconciliation
- [ ] Retire the old backend only after explicit approval
- [ ] Connect the project to the user's GitHub repository and verify code plus database migrations sync
- [ ] Deliver database records and private files through a secure backup outside GitHub

## Current blocker

- [x] Diagnose and repair the latest failed GitHub AWS deployment (`ec2:AssociateRouteTable` was missing; retry cleanup and container packaging corrected).
- [x] Apply the updated deployment policy to the AWS deployment identity and diagnose the cleanup retry failure (ungranted identity lookup).
- [x] Diagnose GitHub run 4: application build succeeded, but Docker copied `/app/dist` while Vite produced `/app/.output`.
- [x] Diagnose GitHub run 5: image succeeded; stack failed because AWS could not create the load-balancer service role, then user-pool deletion protection blocked rollback.
- [x] Diagnose GitHub run 6: image succeeded; AWS free-plan rules rejected the 14-day database backup setting. Align the database with free-plan limits (single-AZ micro, 20 GB, one-day retention, no Performance Insights during bootstrap).
- [x] Rerun infrastructure with the corrected application image.
- [x] AWS foundation stack created successfully (CREATE_COMPLETE, 0 running copies).
- Destination entered recovery after its connection dropped during the bulk restore and is not accepting connections. Source runners, safety switch, and schedules remain paused. Resume only after the destination reports healthy; inspect and clean the partial restore before retrying.
- GitHub repository sync requires the user to authorize GitHub and create/select the repository in Lovable.