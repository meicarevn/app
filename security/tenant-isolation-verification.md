# MEICARE Tenant Isolation Verification

Last verified: 2026-09-05

## Release rule

Cross-tenant access is a release blocker. Any ability for a user in Organization A to read, mutate, enumerate, or invoke a privileged operation against Organization B is SEV-1 and blocks hospital pilot/release.

## Current production verification

Read-only structural audit:

- 40/40 reviewed `public` tables carrying `organization_id` have RLS enabled.
- 0 client-granted tenant tables were found without RLS.
- 80 authenticated tenant policies were reviewed structurally.
- 0 unconditional authenticated `USING (true)` / `WITH CHECK (true)` policies were found.
- 9/9 authenticated public views use `security_invoker=true`.
- 13 authenticated-executable `SECURITY DEFINER` RPCs remain an explicit review surface.
- `private.is_org_member()` and `private.has_org_role()` are `SECURITY DEFINER`, use an empty `search_path`, and query active organization membership by `auth.uid()`.
- Client roles do not have direct schema `USAGE` on `private`.
- `integration.his_connections` has no direct anon/authenticated CRUD grant; its no-policy RLS state is therefore deny-by-default at the grant layer.

Transactional negative test:

1. Create a temporary Organization B, warehouse, and drug inside a transaction as the database owner.
2. `SET LOCAL ROLE authenticated` and set JWT claims to an existing active user belonging to Organization A.
3. Assert own Organization A is visible.
4. Assert Organization B is invisible.
5. Assert Organization B warehouse and drug are invisible.
6. Attempt to update Organization B warehouse and assert 0 rows are affected.
7. Call a tenant-scoped privileged RPC for Organization B and assert `NOT_AUTHORIZED`.
8. Roll back.
9. Verify all temporary Organization B records are absent.

Observed result on 2026-09-05: **PASS**.

## Required pre-pilot symmetric test

The current production database has only one persistent organization and one active member. Before a hospital pilot is marked GO, repeat the tests in both directions using two real isolated test identities:

- User A / Organization A cannot SELECT Organization B data.
- User B / Organization B cannot SELECT Organization A data.
- Both directions cannot UPDATE or DELETE foreign rows.
- Both directions cannot INSERT rows that claim the foreign `organization_id`.
- Tenant-scoped `SECURITY DEFINER` RPCs reject foreign organization IDs.
- Views do not leak foreign data.
- Organization membership cannot be self-escalated or moved across tenants.
- Service-only ingestion/IoT functions remain unavailable to browser/client identities.

## SECURITY DEFINER review policy

Do not treat the Supabase Advisor warning alone as proof of vulnerability and do not revoke `EXECUTE` blindly. For every authenticated-executable `SECURITY DEFINER` function, document:

1. Intended caller role.
2. Tenant identifier source.
3. Explicit membership/role authorization.
4. `search_path` hardening.
5. Validation of referenced entity IDs against the same organization.
6. Audit-log behavior.
7. Side effects and rollback behavior.
8. Whether the function genuinely needs `SECURITY DEFINER`.
9. Whether it should remain in an exposed schema or move behind a narrower API/service boundary.

## CI target

Once the repository contains the canonical Supabase schema/migrations, add pgTAP database tests and run `supabase test db` on every pull request. Tests must use transaction isolation and include negative authorization cases. Do not add a green CI badge or treat this gate as automated until the schema and test runner are actually wired.

## References

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/local-development/testing/overview
