import { describe, expect, it } from "vitest";
import { decoratePromotedDbRows, summarizePromotedDbRows } from "../src/v4-011d-execution";

describe("V4_011D promoted DB read path", () => {
  it("preserves DB semantics while restoring display metadata and legacy aliases", () => {
    const db = [{
      organization_id: "org",
      warehouse_id: "w1",
      drug_id: "d1",
      usable_quantity: 0,
      organization_usable_quantity: 10,
      availability_state: "OUT_OF_STOCK",
      expiry_state: "NONE",
      evidence_state: "INSUFFICIENT_DATA",
      recommendation_state: "TRANSFER_REVIEW",
      recommendation_requires_human_review: true,
      suppress_expected_wastage_claims: false,
      legacy_v4_stock_status: "INSUFFICIENT_DATA",
      legacy_v4_risk_score: 7
    }];
    const metadata = [{
      warehouse_id: "w1",
      drug_id: "d1",
      drugs: { drug_code: "ABC", name: "Drug A" },
      warehouses: { code: "K1", name: "Kho 1" }
    }];
    const [row] = decoratePromotedDbRows(db, metadata);
    expect(row.availability_state).toBe("OUT_OF_STOCK");
    expect(row.recommendation_state).toBe("TRANSFER_REVIEW");
    expect(row.approved_semantic_cohort).toBe("A1");
    expect(row.stock_elsewhere).toBe(true);
    expect(row.stock_status).toBe("INSUFFICIENT_DATA");
    expect(row.risk_score).toBe(7);
    expect(row.drugs).toEqual({ drug_code: "ABC", name: "Drug A" });
    expect(row.warehouses).toEqual({ code: "K1", name: "Kho 1" });
  });

  it("summarizes approved A1/B1 cohorts without inventing automatic actions", () => {
    const rows = decoratePromotedDbRows([
      { warehouse_id: "w1", drug_id: "d1", usable_quantity: 0, organization_usable_quantity: 5, legacy_v4_stock_status: "INSUFFICIENT_DATA", availability_state: "OUT_OF_STOCK", expiry_state: "NONE", evidence_state: "INSUFFICIENT_DATA", recommendation_state: "TRANSFER_REVIEW", recommendation_requires_human_review: true },
      { warehouse_id: "w2", drug_id: "d2", usable_quantity: 0, organization_usable_quantity: 0, legacy_v4_stock_status: "INSUFFICIENT_DATA", availability_state: "OUT_OF_STOCK", expiry_state: "NONE", evidence_state: "INSUFFICIENT_DATA", recommendation_state: "PROCUREMENT_REVIEW", recommendation_requires_human_review: true },
      { warehouse_id: "w3", drug_id: "d3", usable_quantity: 12, organization_usable_quantity: 12, legacy_v4_stock_status: "EXPIRY_RISK", availability_state: "HEALTHY", expiry_state: "CRITICAL", expiry_evidence_mode: "TIME_WINDOW_ONLY", evidence_state: "INSUFFICIENT_DATA", recommendation_state: "FEFO_REVIEW", recommendation_requires_human_review: true, suppress_expected_wastage_claims: true }
    ], []);
    const summary = summarizePromotedDbRows(rows);
    expect(summary.a1).toMatchObject({ total: 2, transfer_review: 1, procurement_review: 1 });
    expect(summary.b1).toMatchObject({ total: 1, critical: 1, time_window_only: 1, wastage_claims_suppressed: 1 });
    expect(summary.human_review_recommendations).toBe(3);
  });
});
