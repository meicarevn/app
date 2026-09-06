# V4_010B — Evidence Correction / Clarification

During V4_010C read-only acceptance, the current `inventory_intelligence_v4` rows for the 19 `EXPIRY_RISK` positions were rechecked.

Clarification:

- demand evidence remains absent for all 19 positions;
- `expiry_quantity_at_risk` and `expiry_value_at_risk` are currently materialized as numeric **0** values, not NULL;
- because there is no finalized demand/true-issue evidence supporting expected use-before-expiry, these zero outputs must **not** be interpreted as evidence that expected wastage is zero;
- under Founder B-approved B1, the Shadow semantic projection therefore suppresses expected-wastage claims whenever the expiry signal is `TIME_WINDOW_ONLY`, regardless of whether engine quantity/value-at-risk fields are NULL or zero.

The approved B1 decision is unchanged: direct expiry dates support the expiry warning; demand-limited expected-wastage inference remains unsupported.
