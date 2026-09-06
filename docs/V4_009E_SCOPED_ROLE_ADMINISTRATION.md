# V4_009E — Scoped Role Administration & Multi-user Acceptance

Status: **database foundation implemented and transactionally validated; production V4 frontend remains disabled**.

## Purpose

V4_009E turns V4 role assignments into a governed administration workflow rather than direct table edits. It also validates that the scoped RBAC model behaves correctly for representative pharmacy roles.

## Role → allowed scope matrix

| Role | ORGANIZATION | ORG_UNIT | WAREHOUSE |
| --- | --- | --- | --- |
| OWNER | ✅ | — | — |
| HOSPITAL_ADMIN | ✅ | — | — |
| PHARMACY_MANAGER | ✅ | ✅ | — |
| PHARMACIST | ✅ | ✅ | ✅ |
| WAREHOUSE_STAFF | — | — | ✅ |
| IT | ✅ | — | — |
| AUDITOR | ✅ | ✅ | ✅ |
| VIEWER | ✅ | ✅ | ✅ |

The database table `role_scope_rules_v4` is the source of truth. Custom roles automatically receive their configured `default_scope`; adding additional scopes for custom roles remains a future explicit admin operation.

## Public RPC contract

All public RPCs are `SECURITY INVOKER`. Privileged logic lives in the non-exposed `private` schema.

### Assign a role

`assign_membership_role_v4(organization, membership, role_code, scope_type, scope_id, valid_from, valid_to, reason)`

Rules:

- requires a real authenticated human;
- requires organization-scope `membership.manage`;
- target membership must belong to the organization and be `INVITED` or `ACTIVE`;
- role must be active and available to the organization;
- role/scope combination must be enabled in `role_scope_rules_v4`;
- `ORG_UNIT` / `WAREHOUSE` scope must belong to the same organization;
- overlapping duplicate assignments are rejected;
- assignment identity is immutable after creation;
- `assigned_by` is taken from `auth.uid()`, not trusted from the client.

### End a role

`end_membership_role_v4(organization, assignment, end_at, reason)`

Role rows are not deleted. Ending an assignment sets `valid_to`, keeping authorization history and audit lineage.

### Read administration state

- `list_membership_role_assignments_v4(organization)`
- `list_role_scope_catalog_v4(organization)`

These require organization-scope `membership.view` or `membership.manage`. A scoped-only manager therefore cannot enumerate the entire hospital membership directory.

## Owner safeguards

- OWNER is organization-scope only.
- OWNER assignments must be open-ended at creation.
- Only a current OWNER may create or end an OWNER assignment.
- HOSPITAL_ADMIN cannot grant OWNER.
- The last current open-ended OWNER cannot be ended.
- Role assignment DELETE is rejected (`ROLE_ASSIGNMENT_HISTORY_IMMUTABLE`).

## Direct table mutation lockdown

`authenticated` now has:

- `SELECT` on `membership_roles`;
- no `INSERT`;
- no `UPDATE`;
- no `DELETE`.

All user-driven mutation therefore goes through the governed RPCs.

## Audit

Every assignment create/end writes append-only `audit_logs` evidence with:

- actor user/membership;
- organization;
- assignment entity id;
- role code;
- scope;
- old/new validity;
- reason;
- source type `ROLE_ADMIN_V4`.

## Private wrapper schema usage

The `private` schema remains outside the exposed PostgREST API schemas. `authenticated` and `service_role` receive schema `USAGE` so public `SECURITY INVOKER` wrappers can call only the private functions for which they also have explicit `EXECUTE` permission.

## Scope-catalog RLS finding and fix

The first multi-role smoke test found that a WAREHOUSE-scoped user correctly saw only Kho 1 inventory (667 rows), but the legacy `warehouses_tenant_select` policy still exposed all 8 warehouse catalog rows.

V4_009E therefore replaced legacy member-wide warehouse/department read policies with scoped V4 policies:

- warehouse reads use `warehouse.view` + organization / org-unit / exact-warehouse scope;
- org-unit reads use `can_view_org_unit_v4`;
- WAREHOUSE-scoped users see only their warehouse and the org-unit ancestor path needed for context;
- warehouse/org-unit management policies also use scoped V4 permissions rather than legacy member-role checks.

## Transactional acceptance evidence

All test users, memberships, assignments and audit rows were created inside rollback-only smoke scopes. No test identity or test role assignment remains in production.

### PHARMACY_MANAGER — ORG_UNIT `PHARMACY`

- inventory rows: **2,244**
- warehouse rows: **8**
- visible org units: **2**
- Production Gate rows: **0**
- organization-wide membership assignment listing: **blocked**

This confirms subtree inventory access without organization-level administration metadata.

### PHARMACIST — ORG_UNIT `PHARMACY-WAREHOUSE`

- inventory rows: **2,244**
- warehouse rows: **8**
- visible org units: **1**
- Production Gate rows: **0**

The current `PHARMACY-WAREHOUSE` logical unit contains all 8 mapped warehouses, so all current inventory rows are expected.

### WAREHOUSE_STAFF — WAREHOUSE `Kho 1`

- expected Kho 1 inventory rows: **667**
- visible inventory rows: **667**
- Action Center rows: **232**
- visible warehouses: **1**
- visible org-unit path: **2** (`Khoa Dược` → `Hệ thống kho dược`)
- Production Gate rows: **0**
- role-administration catalog: **blocked**

This is the strongest narrow-scope isolation acceptance case.

### AUDITOR — ORGANIZATION

- inventory rows: **2,244**
- warehouse rows: **8**
- visible org units: **2**
- Production Gate rows: **1**
- membership assignment listing: allowed by organization-scope `membership.view`

## Administration guard acceptance

Rollback smoke tests also confirmed:

- HOSPITAL_ADMIN → OWNER grant: **blocked**;
- HOSPITAL_ADMIN → VIEWER/WAREHOUSE assignment: **allowed**;
- WAREHOUSE_STAFF assigned at ORG_UNIT scope: **blocked**;
- ending the only OWNER assignment: **blocked**;
- ending then later re-assigning the same role/scope: **allowed** (historical role reuse works);
- audit events are produced before rollback.

## Cleanup / invariants

After all acceptance tests:

- temporary `@example.invalid` organization members: **0**;
- temporary `@example.invalid` auth users: **0**;
- production `ROLE_ADMIN_V4` smoke audit rows: **0**;
- `inventory_ledger_drift_v4`: **0 rows**.

## Production state

V4_009E does **not** change cutover/readiness flags. Keep:

- `cutover_stage = SHADOW`
- `inventory_write_mode = LEGACY`
- `alert_publish_mode = SHADOW`
- `his_ingestion_mode = HYBRID`
- `frontend_v4_ready = false`

No production role-management UI is deployed by this change.
