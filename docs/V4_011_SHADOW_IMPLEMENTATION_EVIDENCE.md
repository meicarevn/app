# V4_011 — Shadow Implementation Evidence

Status: **SHADOW-FIRST / READ-ONLY / NO PRODUCTION SEMANTIC MIGRATION**

Tracking: Issue #23, Draft PR #24.

## Implemented artifacts

- `src/intelligence-v4-011.ts` — deterministic multi-axis projection.
- `test/intelligence-v4-011.test.ts` — A1/B1 and axis-independence tests.
- `shadow-pages/functions/v4/shadow/intelligence-v4-011.ts` — organization-scope GET-only Shadow read model.
- `web-shadow/multi-axis-review.html|js|css` — human acceptance UI.
- `.github/workflows/v4-011-shadow-pages-preview.yml` — isolated Cloudflare preview deployment and fail-closed smoke tests.

## Safety boundary

The first V4_011 implementation is intentionally additive:

- reads from `inventory_intelligence_v4` using the signed-in user's JWT;
- requires `inventory.view` plus ORGANIZATION scope;
- Supabase RLS remains final authority;
- no service-role credential is present in browser/Pages source;
- endpoint accepts GET only;
- no `inventory_intelligence_v4.stock_status` rewrite;
- no alert publication change;
- no ledger/inventory mutation;
- no frontend production routing change;
- `frontend_v4_ready` remains false.

## Conservative recommendation boundary

Founder B explicitly approved transfer/procurement semantics for the A1 cohort (legacy engine `INSUFFICIENT_DATA` with factual zero usable quantity and insufficient demand evidence).

Therefore the first Shadow release does **not** silently generalize transfer/procurement recommendations to all legacy `OUT_OF_STOCK` rows. Those rows remain factual `availability_state=OUT_OF_STOCK`, but new transfer/procurement recommendation semantics outside A1 require a separate product/clinical decision.

This prevents the Shadow implementation from expanding clinical/operational behavior beyond the approved cohort.

## Read-only production-data acceptance snapshot

Primary organization: `68d83220-4e5d-46e7-8bd3-7863205985f4`.

Observed immediately after the implementation was prepared:

- operational rows: **2,244**;
- duplicate `warehouse_id × drug_id` keys: **0**;
- quantity-on-hand sum: **4,953,566**;
- A1 total: **284**;
  - TRANSFER_REVIEW: **39**;
  - PROCUREMENT_REVIEW: **245**;
- B1 total: **19**;
  - CRITICAL: **3**;
  - HIGH: **4**;
  - WARNING: **12**;
- B1 TIME_WINDOW_ONLY: **19**;
- all 19 B1 rows currently have materialized engine `expiry_quantity_at_risk=0` and `expiry_value_at_risk=0`; V4_011 still suppresses expected-wastage claims because demand evidence is absent;
- inventory ledger drift rows: **0**.

Runtime remained:

- `cutover_stage=SHADOW`;
- `inventory_write_mode=LEGACY`;
- `alert_publish_mode=SHADOW`;
- `his_ingestion_mode=HYBRID`;
- `integration_layer_ready=false`;
- `frontend_v4_ready=false`;
- `r2_gateway_ready=false`;
- `iot_gateway_ready=false`;
- `ai_orchestrator_ready=false`.

## Multi-axis behavior

### Availability

A factual `usable_quantity <= 0` always projects `OUT_OF_STOCK`, independent of evidence confidence.

Positive inventory uses existing V4 threshold/status evidence conservatively:

- existing CRITICAL → `CRITICAL`;
- existing REORDER / DEFAULT_LOW_STOCK / LOW_STOCK → `REORDER`;
- existing OVERSTOCK → `OVERSTOCK`;
- missing policy/reference evidence → `INSUFFICIENT_REFERENCE`;
- otherwise positive usable inventory → `HEALTHY`.

### Expiry

Expiry is independent from availability:

- direct CRITICAL/HIGH/WARNING signal is preserved;
- direct near-expiry evidence without an explicit severity falls back to WARNING;
- demand-missing expiry rows carry `TIME_WINDOW_ONLY`.

### Evidence

Evidence is represented independently from inventory facts. Current demand history is not finalized, so accepted A1/B1 rows remain `INSUFFICIENT_DATA` rather than having missing evidence overwrite observable facts.

### Recommendation

All recommendation values are review prompts only and carry `recommendation_requires_human_review=true` when non-NONE.

No executable transfer or procurement quantity is generated.

## Human acceptance target

The isolated V4_011 preview must display:

- projected rows = **2,244**;
- A1 = **284 = 39 + 245**;
- B1 = **19 = 3 + 4 + 12**;
- TIME_WINDOW_ONLY = **19**;
- production runtime/readiness unchanged.

Human acceptance of this page is required before any proposal to create a database-level additive projection or migrate production intelligence semantics.
