# MEICARE V4_013D — Privileged RPC Boundary Hardening

Status: **implemented for review; migration not applied to production**.

## Objective

Remove `SECURITY DEFINER` from the exposed `public` RPC boundary without changing
the names, arguments, defaults, return types, role checks or business behavior
used by the current MEICARE clients.

## Production audit baseline

The Supabase security advisor reports 13 `public` functions that are both
`SECURITY DEFINER` and executable by `authenticated`:

1. `approve_par_proposals`
2. `bootstrap_organization`
3. `change_drug_code_v3`
4. `commit_inventory_period_report`
5. `commit_inventory_snapshot_v2`
6. `provision_his_connection_v2`
7. `refresh_inventory_risks`
8. `refresh_par_proposals`
9. `refresh_stock_position_alerts`
10. `revoke_his_connection_v2`
11. `update_action_status`
12. `update_inventory_policy_settings`
13. `upsert_stock_policies`

The audit also confirmed:

- `anon` cannot execute these functions;
- every function has `search_path = ''`;
- each implementation contains an authenticated-user or organization-role check;
- six functions intentionally retain a `service_role` execution path;
- no database dependency is registered against the function objects;
- `private` is not an API surface used by the MEICARE frontend, while
  `authenticated` already has schema usage for the established wrapper pattern.

The finding is therefore an exposed privileged-boundary problem, not evidence of
known cross-tenant access. It still blocks commercial promotion because a future
editing mistake in a public definer function would bypass RLS.

## Design

For each of the 13 functions, the migration performs one atomic operation:

1. fail if the audited signature or expected privilege is missing;
2. move the existing implementation from `public` to `private`;
3. create a same-signature `public` `SECURITY INVOKER` facade;
4. rebuild ACLs explicitly, denying `PUBLIC` and `anon`;
5. let `authenticated` call only the named private implementations required by
   the facades;
6. preserve the six pre-existing `service_role` grants and revoke all others;
7. verify 13 public invokers and 13 private definers before commit.

The private functions retain their existing in-body checks. The public function
names, parameter defaults and response types remain stable, so current REST RPC
clients do not require a coordinated frontend release.

## Files

- Migration: `20260907163000_v4_013d_privileged_rpc_boundary.sql`
- Acceptance query: `scripts/v4-013d-db-acceptance.sql`
- Rollback: `scripts/v4-013d-db-rollback.sql`
- Static gate: `test/v4-013d-rpc-hardening.test.ts`

## Safety boundary

This increment does not:

- apply DDL to production;
- change RLS policies, table grants or user roles;
- change any function body that contains business logic;
- change production routing, runtime mode or readiness flags;
- create a live VNPT-HIS connection;
- authorize inventory writes or alert publication cutover.

## Controlled activation gate

Before applying the migration:

1. verify the current 13-signature preflight still matches production;
2. verify `private` is absent from the Data API exposed-schema setting;
3. take and verify a recoverable database backup;
4. execute the migration in one transaction during a controlled window;
5. run the acceptance SQL and Supabase security advisor immediately;
6. run authenticated positive tests for each role family and negative tests for
   anonymous and cross-tenant callers;
7. run the rollback script if any signature, ACL, response or advisor gate fails.

Only the database-activation evidence can close V4_013D. Static CI proves the
migration package is internally consistent, not that production has changed.
