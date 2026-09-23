# External backend migration

- [x] Inventory source schema, auth, storage, and running automation
- [x] Create a private backup of the complete public schema and data
- [ ] Validate destination database access and confirm it is empty
- [ ] Pause automation and capture final source checksums
- [ ] Restore schema, data, and private storage to the destination
- [ ] Reconfigure authentication and application database bindings
- [ ] Recreate schedules with dedicated scheduler authentication
- [ ] Validate data, access rules, storage, and paper/live safety flows
- [ ] Resume paper, then live automation after reconciliation
- [ ] Retire the old backend only after explicit approval