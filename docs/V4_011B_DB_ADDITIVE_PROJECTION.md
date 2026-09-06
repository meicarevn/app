# V4_011B — Additive Database Multi-axis Projection

Status: **CONTROLLED PRODUCTION MIGRATION APPLIED / ACCEPTANCE PASS**

Tracking: #25

Production migration: `20260906072831_v4_011b_additive_multi_axis_projection`

Founder A approval: explicitly recorded in the project conversation on 2026-09-06 before production DDL.

## Purpose

Translate the human-accepted V4_011 Shadow semantics into a database-level additive read model without rewriting `inventory_intelligence_v4.stock_status`, publishing alerts, mutating inventory, or changing frontend/runtime readiness.

## Production object

`public.inventory_intelligence_multi_axis_v4_011`

Properties verified after deployment:

- regular Postgres view;
- `security_invoker = true`;
- reads only from `public.inventory_intelligence_v4`;
- underlying scoped RLS remains the final access authority;
- anonymous SELECT is revoked;
- authenticated and service-role SELECT are granted;
- no SECURITY DEFINER function;
- no mutation RPC;
- no materialized state.

## Semantics carried forward

### Availability

- usable <= 0 => `OUT_OF_STOCK`;
- legacy critical => `CRITICAL`;
- legacy reorder/default-low => `REORDER`;
- legacy overstock => `OVERSTOCK`;
- positive stock with missing policy/reference evidence => `INSUFFICIENT_REFERENCE`;
- otherwise `HEALTHY`.

### Expiry

- direct `highest_expiry_risk` CRITICAL/HIGH/WARNING is preserved;
- direct near-expiry evidence without explicit severity maps to WARNING;
- no expiry evidence => NONE.

### Evidence

- no finalized forecast and no true issue history => `INSUFFICIENT_DATA`;
- expiry with partial quantitative inference => `LIMITED` when applicable;
- otherwise `SUFFICIENT`;
- evidence qualifiers are explicit arrays.

### Recommendations

The first DB release intentionally stays conservative:

- A1-approved cohort only (`legacy_v4_stock_status = INSUFFICIENT_DATA` and usable <= 0):
  - usable stock elsewhere => `TRANSFER_REVIEW`;
  - organization usable zero => `PROCUREMENT_REVIEW`;
- direct expiry risk => `FEFO_REVIEW`;
- all other rows => `NONE`.

Every non-NONE recommendation sets `recommendation_requires_human_review = true`.

## B1 expected-wastage suppression

For `TIME_WINDOW_ONLY` expiry evidence:

- `suppress_expected_wastage_claims = true`;
- `supported_expiry_quantity_at_risk = NULL`;
- `supported_expiry_value_at_risk = NULL`.

The raw legacy engine fields remain visible separately for audit/compatibility but are not presented as supported expected-wastage claims.

## Controlled production acceptance — PASS

Post-migration read-only acceptance returned:

- operational rows = 2,244;
- duplicate warehouse×drug keys = 0;
- quantity-on-hand total = 4,953,566, exactly equal to `inventory_intelligence_v4` truth;
- A1 = 284;
- A1 `OUT_OF_STOCK` = 284;
- A1 `INSUFFICIENT_DATA` evidence = 284;
- A1 recommendations = 39 `TRANSFER_REVIEW` + 245 `PROCUREMENT_REVIEW`;
- B1 = 19 = 3 CRITICAL + 4 HIGH + 12 WARNING;
- B1 `TIME_WINDOW_ONLY` = 19;
- B1 expected-wastage claims suppressed = 19;
- B1 supported expiry quantity/value are NULL for all 19 rows;
- actionable recommendations without human-review flag = 0;
- inventory ledger drift = 0.

## RLS / privilege acceptance — PASS

Verified after deployment:

- view reloption contains `security_invoker=true`;
- underlying `inventory_intelligence_v4` has RLS enabled;
- underlying policy remains `inventory_intelligence_v4_scoped_select` using `private.has_scoped_permission_v4(..., 'inventory.view', warehouse_id, NULL)`;
- `anon` has no SELECT privilege on the V4_011 view;
- authenticated OWNER session sees 2,244 rows, one organization, QOH 4,953,566;
- authenticated synthetic user with no active organization role sees 0 rows;
- production currently has only the OWNER organization-scope assignment, so no real warehouse-scoped secondary user was available for a non-destructive live role test.

## Advisor result

Security Advisor and Performance Advisor were run before and after the DDL. No new lint specific to `inventory_intelligence_multi_axis_v4_011` was introduced.

Pre-existing security debt remains outside this migration scope:

- legacy public authenticated SECURITY DEFINER RPC exposure;
- leaked-password protection disabled.

Pre-existing performance notices remain outside this migration scope:

- unindexed foreign keys;
- unused indexes;
- multiple permissive SELECT policies on several legacy tables.

## Rollback

Rollback artifact: `scripts/v4-011b-db-rollback.sql`.

Rollback is additive-object removal only:

```sql
drop view if exists public.inventory_intelligence_multi_axis_v4_011;
```

Rollback was **not executed** because all acceptance invariants passed.

## Runtime boundary preserved

The migration does not change runtime/cutover flags. The following remain required until their own gates pass:

- `cutover_stage = SHADOW`;
- `inventory_write_mode = LEGACY`;
- `alert_publish_mode = SHADOW`;
- `his_ingestion_mode = HYBRID`;
- `frontend_v4_ready = false`;
- no inventory/ledger mutation;
- no alert publication cutover.
