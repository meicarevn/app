# V4_010B — Founder B Approval Record

Founder B explicitly approved **A1** and **B1** for V4_010B.

Approved semantic direction:

- **A1:** when `usable_quantity <= 0`, preserve factual `OUT_OF_STOCK` as the primary availability state; represent `INSUFFICIENT_DATA` separately as an evidence/confidence qualifier when demand evidence is insufficient.
- **B1:** preserve `EXPIRY_RISK` from direct expiry-date evidence even when demand evidence is insufficient; mark the signal `TIME_WINDOW_ONLY` / confidence-limited and do not claim `quantity_at_risk`, `value_at_risk`, or expected wastage without sufficient demand evidence.

Implementation boundary after approval:

1. Implement the approved model in the isolated V4 Shadow layer first.
2. Do not mutate inventory quantities, ledger truth, or production alert publication.
3. Do not change production `inventory_intelligence_v4.stock_status` in this step.
4. Validate the 284 zero-stock cohort and 19 expiry-risk cohort against the approved semantics.
5. Keep `frontend_v4_ready=false` and `alert_publish_mode=SHADOW` until separate production promotion gates are satisfied.

Approval source: explicit Founder B confirmation in the MEICARE working session on 2026-09-06.
