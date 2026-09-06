# V4_010C — Shadow Semantic Implementation Plan

Status: **IMPLEMENTATION PLAN — SHADOW ONLY**

Founder B has approved V4_010B A1 and B1. This document defines the implementation boundary for the next step.

## Approved semantic model

### Availability
- If `usable_quantity <= 0`, primary availability = `OUT_OF_STOCK`.
- If demand evidence is insufficient, add evidence qualifier `INSUFFICIENT_DATA` rather than replacing availability.

### Expiry
- Preserve `EXPIRY_RISK` when direct lot expiry evidence crosses configured time windows.
- Mark demand-limited expiry signals `TIME_WINDOW_ONLY`.
- Do not claim `quantity_at_risk`, `value_at_risk`, or expected wastage without sufficient demand evidence.

## Shadow projection contract

The Shadow API/UI will expose separate fields derived from existing V4 evidence without changing production intelligence rows:

- `availability_status`
- `evidence_confidence`
- `expiry_status`
- `expiry_evidence_basis`
- `recommended_review_action`
- `semantic_model_version = V4_010C_A1_B1`

Underlying `stock_status` remains visible as `engine_stock_status` for traceability during acceptance.

## Cohort acceptance targets

- 284 current `INSUFFICIENT_DATA` rows with `usable_quantity = 0` must project `availability_status = OUT_OF_STOCK` and `evidence_confidence = INSUFFICIENT_DATA`.
- 39 of those positions with stock in another warehouse should recommend `TRANSFER_REVIEW`.
- 245 organization-wide-zero positions should recommend `PROCUREMENT_REVIEW`.
- 19 current `EXPIRY_RISK` positions must preserve expiry severity from direct date evidence, carry `TIME_WINDOW_ONLY`, and avoid unsupported expected-wastage claims.

## Release boundary

- No production DDL in this step.
- No production inventory mutation.
- No production `stock_status` rewrite.
- No V4 alert publication.
- `frontend_v4_ready` remains false.
- `alert_publish_mode` remains SHADOW.
