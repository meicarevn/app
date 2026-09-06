# V4_011B — Additive Database Multi-axis Projection

Status: **REVIEW-ONLY / NOT APPLIED TO PRODUCTION**

Tracking: #25

## Purpose

Translate the human-accepted V4_011 Shadow semantics into a database-level additive read model without rewriting `inventory_intelligence_v4.stock_status`, publishing alerts, mutating inventory, or changing frontend/runtime readiness.

## Proposed object

`public.inventory_intelligence_multi_axis_v4_011`

Properties:

- regular Postgres view;
- `security_invoker = true`;
- reads only from `public.inventory_intelligence_v4`;
- underlying scoped RLS remains the final access authority;
- anonymous access revoked;
- authenticated and service-role read grants only;
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

The first DB proposal intentionally stays conservative:

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

## Current read-only preflight evidence

Production data was inspected without DDL or mutation before preparing this proposal:

- `inventory_intelligence_v4` is a regular table;
- current scoped SELECT policy: `inventory_intelligence_v4_scoped_select` using `private.has_scoped_permission_v4(..., 'inventory.view', warehouse_id, NULL)`;
- current columns support the proposed additive view without schema mutation;
- 2,244 operational keys;
- duplicate warehouse×drug keys = 0;
- quantity-on-hand total = 4,953,566;
- A1 = 284 = 39 transfer + 245 procurement;
- B1 = 19 = 3 critical + 4 high + 12 warning;
- B1 TIME_WINDOW_ONLY = 19;
- ledger drift = 0.

## Acceptance SQL

`scripts/v4-011b-db-acceptance.sql` is intended to run only after the view is installed in an approved environment. It validates key count, quantity truth, A1/B1 cohorts, human-review requirement and ledger drift.

## Release gate

This repository change **does not authorize production DDL**.

Before applying the migration to production, require a separate Founder A approval because this changes the production database/API surface, even though it is additive and read-only.

After any approved DDL deployment:

1. run the acceptance SQL;
2. run Supabase Security Advisor;
3. run Supabase Performance Advisor;
4. verify RLS behavior with authenticated scoped roles;
5. verify ledger drift remains zero;
6. keep `frontend_v4_ready=false` and `alert_publish_mode=SHADOW` until their own gates pass.
