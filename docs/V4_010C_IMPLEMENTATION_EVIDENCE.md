# V4_010C — A1/B1 Shadow Semantic Implementation Evidence

Status: **SHADOW-ONLY IMPLEMENTATION**

Founder B approval is recorded in `docs/V4_010B_FOUNDER_B_APPROVAL.md`.

## Implemented

- shared semantic projection module: `src/semantic-v4-010c.ts`;
- unit tests: `test/semantic-v4-010c.test.ts`;
- isolated acceptance page: `/semantic-review.html`;
- browser client computes the approved A1/B1 projection from existing read-only V4 inventory rows;
- Cloudflare preview workflow validates the new JavaScript, static semantic markers, unit tests, and live page availability.

## A1 behavior

For engine rows where `stock_status=INSUFFICIENT_DATA` and `usable_quantity=0`:

- projected `availability_status=OUT_OF_STOCK`;
- projected `evidence_confidence=INSUFFICIENT_DATA`;
- underlying engine status remains visible for traceability;
- stock in another warehouse → `TRANSFER_REVIEW`;
- organization-wide zero → `PROCUREMENT_REVIEW`;
- no automatic recommended order quantity is introduced.

Expected production-data acceptance cohort from the Founder B review: **284 positions = 39 transfer-review + 245 procurement-review**.

## B1 behavior

For engine `EXPIRY_RISK` rows:

- direct expiry severity remains visible as `CRITICAL/HIGH/WARNING`;
- missing demand evidence yields `expiry_evidence_basis=TIME_WINDOW_ONLY`;
- expected-wastage claims are explicitly suppressed;
- human action remains `FEFO_REVIEW`.

Expected production-data acceptance cohort: **19 positions**.

## Production boundary

This implementation does not modify:

- `inventory_intelligence_v4.stock_status`;
- inventory ledger quantities;
- alert publication;
- action execution;
- `frontend_v4_ready`;
- cutover stage.

Runtime must remain `SHADOW / LEGACY / SHADOW / HYBRID` until separate release gates are approved.
