# V4_010 — V3 ↔ V4 Semantic Acceptance

Status: **REVIEW EVIDENCE ONLY — NO SEMANTIC CHANGE AUTHORIZED**

Issue: #19

## Purpose

Separate inventory truth alignment from alert/intelligence semantics before any V4 frontend-readiness decision. This document does not approve or modify pharmacy prioritization rules. Any change to medication risk, alert precedence, or interpretation requires Founder B review under the MEICARE release gate.

## Quantity truth

Warehouse × drug operational-key comparison for the primary organization:

- V3 warehouse rows: **2,244**
- V4 rows: **2,244**
- matched operational keys: **2,244**
- missing in V3: **0**
- missing in V4: **0**
- quantity mismatch rows: **0**
- absolute quantity delta: **0.000**

**Quantity truth acceptance: PASS.**

## Status-pair decomposition

The previously reported `status_mismatch_count = 1,693` is a string-status comparison and must not be interpreted as 1,693 inventory errors.

| V3 status | V4 status | Rows | Quantity delta | Review class |
|---|---|---:|---:|---|
| DEFAULT_HEALTHY | HEALTHY | 1,390 | 0.000 | Label normalization / presentation review |
| OUT_OF_STOCK | INSUFFICIENT_DATA | 284 | 0.000 | **Founder B semantic decision required** |
| DEFAULT_HEALTHY | EXPIRY_RISK | 13 | 0.000 | **Founder B semantic review required** |
| DEFAULT_LOW_STOCK | EXPIRY_RISK | 6 | 0.000 | **Founder B semantic review required** |

Rows whose strings already match are not part of the 1,693 count:

- OUT_OF_STOCK → OUT_OF_STOCK: 437
- DEFAULT_LOW_STOCK → DEFAULT_LOW_STOCK: 114

Therefore the 1,693 mismatches decompose exactly into **1,390 label-normalization rows + 284 zero-stock/insufficient-evidence rows + 19 expiry-priority rows**.

## Current evidence limitation

Current production intelligence does not yet have finalized demand coverage:

- V4 inventory positions: **2,244**
- positions with missing `forecast_daily_demand`: **2,244**
- positions with absent/insufficient demand pattern: **2,244**
- positions with absent/insufficient slow-use evidence: **2,244**
- `inventory_day_coverage_v4` rows: **0**
- `drug_forecasts_v4` rows: **0**

Consequently, demand-dependent semantics are provisional. The current dataset supports inventory quantity, lot/expiry and reference-stock evidence, but it does not support a production claim that demand forecasting or slow-moving classification is complete.

## Founder B decision A — zero stock without demand/reference evidence

There are **284** positions where:

- V3 = `OUT_OF_STOCK`
- V4 = `INSUFFICIENT_DATA`
- quantity on hand = 0
- usable quantity = 0
- `reference_stock = 0`
- `reference_basis = INSUFFICIENT_DATA`
- forecast/demand evidence is absent
- V4 recommendation basis = `INSUFFICIENT_DATA`

Representative examples include drug code 15267 Haloperidol 0.5% at Kho 1 and drug code 15268 Levobupi-BFS 50 mg at Kho 1. These are examples only; no change is inferred from the medicine names themselves.

Founder B must choose the product/safety semantics before cutover. The key question is:

> When physical stock is exactly zero but MEICARE does not yet have evidence that the item is expected to be stocked/consumed at that warehouse, should the primary user-facing status remain `OUT_OF_STOCK`, or should V4 preserve `INSUFFICIENT_DATA` and expose physical zero stock as a separate fact?

No automatic normalization is applied in V4_010.

## Founder B decision B — expiry risk precedence

There are **19** positions where V3's stock-level label is replaced by V4 `EXPIRY_RISK`:

- 13 from V3 `DEFAULT_HEALTHY`
- 6 from V3 `DEFAULT_LOW_STOCK`
- all have non-zero near-expiry quantity
- observed highest expiry risk is WARNING, HIGH or CRITICAL
- observed `expiry_quantity_at_risk = 0` and `expiry_value_at_risk = 0` because demand forecasts are absent

Representative cases:

- code 15357 Amiodarona GP, Kho 3 — 17 units near expiry, V3 low stock → V4 expiry risk, WARNING;
- code 18839 Umkanas, Kho 3 / Kho 5 — HIGH expiry signal;
- code 18978 Dobcard 250 mg/20 ml, Kho 3 / Kho 54 — HIGH expiry signal;
- code 20108 Nimovac-V, Kho 1 / Kho 3 / Kho 54 — CRITICAL expiry signal.

Founder B should confirm whether time-window expiry risk should continue to take precedence over the V3 stock-level label when demand forecasting is unavailable, and how the UI should distinguish a time-window warning from a forecasted excess-at-expiry estimate.

No expiry-priority rule is changed in V4_010.

## Label normalization

`DEFAULT_HEALTHY → HEALTHY` affects **1,390** positions with zero quantity delta. This appears to be a naming/presentation normalization between V3 fallback semantics and V4's user-facing status vocabulary. It should be documented in the UI rather than counted as a truth mismatch. This classification is a product interpretation only; it does not authorize an engine change.

## Acceptance conclusion

- Operational quantity truth: **PASS**.
- Key coverage: **PASS**.
- Demand/forecast completeness: **NOT READY**.
- 1,390 status differences: presentation/label review.
- 284 zero-stock differences: **Founder B semantic decision required**.
- 19 expiry-precedence differences: **Founder B semantic review required**.
- `frontend_v4_ready` must remain **false** until full frontend acceptance and the relevant semantic decisions are recorded.
