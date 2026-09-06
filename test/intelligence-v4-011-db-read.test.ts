import { describe, expect, it } from "vitest";
import { hydratePromotedDbRows, promotedMetadataComplete, summarizePromotedDbRows } from "../src/intelligence-v4-011-db-read";

describe("V4_011D2 promoted DB read adapter", () => {
  it("preserves A1/B1 semantics and human-review safety", () => {
    const rows = [
      { drug_id: "d1", warehouse_id: "w1", usable_quantity: 0, organization_usable_quantity: 5, legacy_v4_stock_status: "INSUFFICIENT_DATA", availability_state: "OUT_OF_STOCK", expiry_state: "NONE", evidence_state: "INSUFFICIENT_DATA", recommendation_state: "TRANSFER_REVIEW", expiry_evidence_mode: "NONE", recommendation_requires_human_review: true, suppress_expected_wastage_claims: false },
      { drug_id: "d1", warehouse_id: "w2", usable_quantity: 5, organization_usable_quantity: 5, legacy_v4_stock_status: "HEALTHY", availability_state: "HEALTHY", expiry_state: "NONE", evidence_state: "SUFFICIENT", recommendation_state: "NONE", expiry_evidence_mode: "NONE", recommendation_requires_human_review: false, suppress_expected_wastage_claims: false },
      { drug_id: "d2", warehouse_id: "w1", usable_quantity: 10, organization_usable_quantity: 10, legacy_v4_stock_status: "EXPIRY_RISK", availability_state: "HEALTHY", expiry_state: "HIGH", evidence_state: "INSUFFICIENT_DATA", recommendation_state: "FEFO_REVIEW", expiry_evidence_mode: "TIME_WINDOW_ONLY", recommendation_requires_human_review: true, suppress_expected_wastage_claims: true }
    ];
    const drugs = [{ id: "d1", drug_code: "D1" }, { id: "d2", drug_code: "D2" }];
    const warehouses = [{ id: "w1", code: "W1" }, { id: "w2", code: "W2" }];
    const hydrated = hydratePromotedDbRows(rows, drugs, warehouses);
    const summary = summarizePromotedDbRows(hydrated);
    expect(promotedMetadataComplete(hydrated)).toBe(true);
    expect(hydrated[0].approved_semantic_cohort).toBe("A1");
    expect(hydrated[0].stock_elsewhere).toBe(true);
    expect(hydrated[2].approved_semantic_cohort).toBe("B1");
    expect(summary.a1.transfer_review).toBe(1);
    expect(summary.b1.high).toBe(1);
    expect(summary.recommendations_without_human_review).toBe(0);
  });

  it("fails metadata completeness when a referenced label cannot be resolved", () => {
    const hydrated = hydratePromotedDbRows([{ drug_id: "missing", warehouse_id: "w1" }], [], [{ id: "w1" }]);
    expect(promotedMetadataComplete(hydrated)).toBe(false);
  });
});
