# V4_011 — Production-grade Multi-axis Inventory Intelligence Model

Status: DESIGN / SHADOW-FIRST. No production semantic migration in this step.

Tracking: #23

## 1. Purpose

V4_010C proved that one overloaded `stock_status` cannot faithfully represent four different questions at once:

1. What is the observable inventory availability now?
2. Is there direct expiry risk?
3. How strong is the evidence behind analytical conclusions?
4. What human action should be reviewed next?

V4_011 separates these concerns into orthogonal axes while keeping `drug_code × warehouse` as the operational identity and `drug_code × batch × expiry × warehouse` as the traceability identity.

## 2. Approved semantic invariants

### A1 — factual stockout remains factual

When `usable_quantity <= 0`:

- `availability_state = OUT_OF_STOCK`;
- demand insufficiency is represented separately in `evidence_state` / qualifiers;
- missing forecast evidence must never replace an observable stockout fact.

For the current accepted cohort:

- 284 warehouse×drug positions are factual stockouts with insufficient demand evidence;
- 39 have usable stock elsewhere in the organization → `TRANSFER_REVIEW`;
- 245 have organization-wide usable quantity = 0 → `PROCUREMENT_REVIEW`;
- no automatic recommended order quantity is allowed without sufficient demand/policy evidence.

### B1 — direct expiry evidence survives low analytical confidence

When lot expiry dates support an expiry warning:

- `expiry_state` may be CRITICAL / HIGH / WARNING even if demand evidence is insufficient;
- add qualifier `TIME_WINDOW_ONLY` when expiry classification is based on the remaining-date window without supported expected-consumption inference;
- do not claim expected quantity/value wastage unless demand evidence is sufficient.

For the current accepted cohort:

- 19 expiry-risk warehouse×drug positions;
- 3 CRITICAL, 4 HIGH, 12 WARNING;
- all are TIME_WINDOW_ONLY under current evidence conditions.

## 3. Proposed canonical axes

### 3.1 Availability axis

`availability_state`

Recommended values:

- `OUT_OF_STOCK`
- `CRITICAL`
- `REORDER`
- `HEALTHY`
- `OVERSTOCK`
- `INSUFFICIENT_REFERENCE`

Rules:

- availability is driven by observable usable quantity plus approved policy/reference thresholds;
- `OUT_OF_STOCK` takes precedence when usable quantity is zero or less;
- missing demand evidence must not convert a factual OUT_OF_STOCK into INSUFFICIENT_DATA;
- if usable quantity is positive but required policy/reference evidence is absent, use `INSUFFICIENT_REFERENCE` rather than inventing a healthy/low interpretation.

### 3.2 Expiry axis

`expiry_state`

Values:

- `CRITICAL`
- `HIGH`
- `WARNING`
- `NONE`

The expiry axis is supported by direct lot/batch/expiry evidence. It is independent of availability.

Examples:

- `OUT_OF_STOCK + NONE`
- `HEALTHY + WARNING`
- `REORDER + HIGH`

### 3.3 Evidence axis

`evidence_state`

Values:

- `SUFFICIENT`
- `LIMITED`
- `INSUFFICIENT_DATA`

Additional evidence qualifiers may include:

- `TIME_WINDOW_ONLY`
- `NO_FINALIZED_DEMAND_HISTORY`
- `NO_TRUE_ISSUE_HISTORY`
- `MISSING_POLICY_REFERENCE`
- `MISSING_UNIT_COST`
- `STALE_SOURCE`

This axis describes confidence/evidence completeness. It is not an inventory fact.

### 3.4 Recommendation axis

`recommendation_state`

Values initially proposed:

- `TRANSFER_REVIEW`
- `PROCUREMENT_REVIEW`
- `FEFO_REVIEW`
- `POLICY_REVIEW`
- `DATA_REVIEW`
- `NONE`

Recommendations are human-review prompts only. They must never imply automatic execution.

## 4. Proposed additive Shadow projection

The first V4_011 implementation should be additive and read-only. Proposed projection fields:

```text
organization_id
warehouse_id
warehouse_code
warehouse_name
drug_id
drug_code
drug_name
quantity_on_hand
usable_quantity
reserved_quantity
quarantine_quantity
rejected_quantity
nearest_expiry

availability_state
availability_reason_codes[]

expiry_state
expiry_reason_codes[]
expiry_evidence_mode

 evidence_state
 evidence_qualifiers[]
 demand_confidence

recommendation_state
recommendation_reason_codes[]
recommendation_requires_human_review = true

legacy_v4_stock_status
legacy_v3_status
calculated_at
model_version = V4_011_MULTI_AXIS
```

Implementation may normalize arrays/JSON depending on Postgres compatibility and query ergonomics, but semantics above should remain explicit.

## 5. Decision order

The engine should calculate axes independently rather than by one global precedence chain.

### Availability

1. derive usable quantity from canonical inventory truth;
2. if usable <= 0 → OUT_OF_STOCK;
3. otherwise evaluate approved policy thresholds if evidence exists;
4. if required policy/reference evidence is missing → INSUFFICIENT_REFERENCE;
5. otherwise derive CRITICAL / REORDER / HEALTHY / OVERSTOCK.

### Expiry

1. inspect usable lots only;
2. exclude expired/quarantined/rejected lots according to existing rules;
3. derive nearest/direct expiry severity;
4. if expiry exists but demand inference is unsupported → TIME_WINDOW_ONLY qualifier;
5. never manufacture expected wastage from missing demand evidence.

### Evidence

Evidence state is computed independently from facts. A row can therefore be:

```text
availability = OUT_OF_STOCK
expiry = NONE
evidence = INSUFFICIENT_DATA
recommendation = PROCUREMENT_REVIEW
```

or:

```text
availability = HEALTHY
expiry = HIGH
evidence = LIMITED + TIME_WINDOW_ONLY
recommendation = FEFO_REVIEW
```

## 6. Recommendation rules for first Shadow release

Initial deterministic rules should remain conservative:

- `OUT_OF_STOCK` + usable stock elsewhere > 0 → `TRANSFER_REVIEW`;
- `OUT_OF_STOCK` + organization usable stock = 0 → `PROCUREMENT_REVIEW`;
- expiry state CRITICAL/HIGH/WARNING → `FEFO_REVIEW` unless a higher-priority human review is explicitly approved later;
- insufficient reference/policy evidence → `POLICY_REVIEW` or `DATA_REVIEW`;
- no recommendation should contain an executable quantity unless the corresponding demand/policy evidence passes a separate gate.

If multiple recommendations apply, the data model should preserve all reason codes even if the UI displays one primary recommendation.

## 7. Compatibility strategy

V4_011 must not rewrite existing production columns initially.

Phase 1 — Shadow additive projection:
- new view/function or read model only;
- current V4 `stock_status` remains untouched;
- compare all 2,244 operational keys.

Phase 2 — Shadow UI acceptance:
- render axes explicitly;
- compare against V4_010C accepted cohorts;
- verify scoped RLS and responsive UX.

Phase 3 — clinical/product gate:
- Founder B reviews any new threshold or precedence behavior beyond A1/B1.

Phase 4 — production migration proposal:
- only after evidence and release gates;
- additive schema preferred before deprecating legacy status semantics.

## 8. Required invariants

Every V4_011 change must preserve:

- quantity truth: V3/V4 operational key counts and quantity reconciliation remain unchanged;
- inventory ledger drift = 0;
- no automatic inventory mutation;
- no automatic procurement or transfer execution;
- alerts remain SHADOW until a separate release gate;
- `frontend_v4_ready=false` during Shadow implementation;
- scoped RBAC/RLS remains final authority;
- no service-role credential in browser code.

## 9. Shadow acceptance criteria

First V4_011 Shadow implementation must demonstrate:

- 2,244 current warehouse×drug keys remain present and quantity-identical;
- A1 cohort = 284 OUT_OF_STOCK with `INSUFFICIENT_DATA` evidence qualifier;
- A1 recommendation split = 39 TRANSFER_REVIEW + 245 PROCUREMENT_REVIEW;
- B1 cohort = 19 expiry positions with 3 CRITICAL + 4 HIGH + 12 WARNING;
- all 19 B1 rows retain TIME_WINDOW_ONLY while demand evidence is absent;
- no expected-wastage quantity/value claim on those 19 rows;
- human-review flag true for all actionable recommendations;
- no production runtime/readiness changes.

## 10. Explicit non-goals for this design step

This design does not authorize:

- production `stock_status` rewrite;
- changing alert publication out of SHADOW;
- enabling `frontend_v4_ready`;
- generating procurement quantities without demand evidence;
- automating transfer/procurement/FEFO execution;
- merging stacked V4 PRs into production without the required founder gates.
