# V4_009C — Scoped RBAC / Row-Level Access Hardening

Status: database migration applied; production runtime remains SHADOW. No frontend readiness flag changed.

## Scope implemented in Supabase

Migration: `v4_009c_scoped_rbac_read_hardening`

New private helpers:

- `private.org_unit_descends_from_v4(org, ancestor_org_unit, target_org_unit)` — descendant-aware hierarchy check with bounded recursion.
- `private.has_scoped_permission_v4(org, permission, warehouse_id?, org_unit_id?)` — evaluates active V4 membership roles with ORGANIZATION, ORG_UNIT and WAREHOUSE scopes.

Semantics:

- ORGANIZATION assignment can read all rows for that permission in the organization.
- WAREHOUSE assignment can read only rows bound to that exact warehouse.
- ORG_UNIT assignment can read its own org unit and descendant org units; for warehouse rows it resolves the warehouse's `org_unit_id` and checks the hierarchy.
- Rows with no warehouse/org-unit scope are visible only to organization-scoped assignments.

RLS SELECT policies were hardened for:

- `inventory_intelligence_v4` (`inventory.view`)
- `alerts`, `actions` (`workflow.view`)
- `inventory_reconciliation_lines`, `reconciliation_cases` (`reconciliation.view`)
- `inventory_reconciliations` (organization-scope reconciliation summary only)
- `devices`, `device_assignments_v4`, `device_current_state`, `sensor_readings`, `environment_excursions`, `excursion_affected_lots`, `device_calibrations` (`iot.view`)
- `document_registry_v4` (`document.view` + `document.sensitive_view` for L4)
- `organization_runtime_v4` (`organization.view`, organization scope only)

A compatibility view was added:

- `inventory_management_v3_scoped_v4` — security-invoker wrapper that applies the same warehouse-aware `inventory.view` scope to the V3 read model, for safe V3↔V4 comparison.

## Transactional acceptance evidence

The current OWNER assignment was temporarily changed inside an explicit transaction from ORGANIZATION scope to warehouse `Kho 1`, then the session was executed as the real authenticated user and rolled back.

Observed:

- V4 inventory visible rows: `667`
- V4 rows in selected warehouse: `667`
- scoped V3 compatibility rows: `667`
- production readiness visible rows: `0`
- organization reconciliation summary visible rows: `0`

This demonstrates exact warehouse isolation for inventory and fail-closed behavior for organization-level operational metadata.

A second authenticated test with the normal ORGANIZATION-scoped OWNER assignment showed:

- V4 inventory visible rows: `2244`
- scoped V3 compatibility rows: `2244`
- production readiness rows: `1`

All role changes were rolled back. No test membership or inventory data remains.

## Important current data note

Existing production warehouses currently have `org_unit_id = NULL`, so ORG_UNIT→warehouse inheritance cannot yet be demonstrated against live production warehouse assignments. The hierarchy-aware helper is implemented, but acceptance of descendant org-unit inheritance should be repeated once warehouses are mapped to departments/org units.

## Remaining application change

The Shadow Worker should now:

1. use `inventory_management_v3_scoped_v4` for V3↔V4 comparison;
2. keep Production Gate / runtime readiness organization-scope only;
3. treat organization-level reconciliation summaries as organization-scope only until a per-warehouse aggregate is introduced;
4. keep RLS as final authority even when UI navigation hides a route.

## Production invariants

- no inventory mutation;
- `cutover_stage=SHADOW`;
- `inventory_write_mode=LEGACY`;
- `alert_publish_mode=SHADOW`;
- `his_ingestion_mode=HYBRID`;
- `frontend_v4_ready=false`;
- ledger drift remains zero.
