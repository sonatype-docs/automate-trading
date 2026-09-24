# Full AWS migration

- [ ] Connect a dedicated least-privilege AWS account identity
- [ ] Inventory accessible AWS account, regions, domains, and existing resources (read-only)
- [ ] Finalize the production region and domain
- [ ] Produce and approve the exact AWS architecture, monthly estimate, and blast radius
- [ ] Add infrastructure-as-code for CloudFront, S3, compute, PostgreSQL, identity, schedules, secrets, monitoring, backups, and networking
- [ ] Export and transfer the complete application database and private files
- [ ] Deploy and validate the application on AWS while trading remains paused
- [ ] Reconcile exchange orders and positions; resume paper, then live trading
- [ ] Retire Lovable hosting and the old backend only after explicit approval

## Superseded destination

- The incomplete external Supabase restore is superseded by the requested full AWS migration. Do not resume or retire anything until AWS validation succeeds.

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

- Destination entered recovery after its connection dropped during the bulk restore and is not accepting connections. Source runners, safety switch, and schedules remain paused. Resume only after the destination reports healthy; inspect and clean the partial restore before retrying.
- GitHub repository sync requires the user to authorize GitHub and create/select the repository in Lovable.