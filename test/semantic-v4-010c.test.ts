import { describe, expect, it } from "vitest";
import { projectSemanticState, withTransferRecommendation } from "../src/semantic-v4-010c";

describe("V4_010C Founder B A1/B1 semantic projection", () => {
  it("A1 preserves OUT_OF_STOCK while qualifying insufficient demand evidence", () => {
    const p = projectSemanticState({
      stock_status: "INSUFFICIENT_DATA",
      usable_quantity: 0,
      forecast_daily_demand: null,
      last_true_issue_at: null,
      highest_expiry_risk: null,
      near_expiry_quantity: 0
    });
    expect(p.availability_status).toBe("OUT_OF_STOCK");
    expect(p.evidence_confidence).toBe("INSUFFICIENT_DATA");
    expect(p.engine_stock_status).toBe("INSUFFICIENT_DATA");
    expect(p.recommended_review_action).toBe("PROCUREMENT_REVIEW");
  });

  it("A1 changes the human review action to transfer review when stock exists elsewhere", () => {
    const p = withTransferRecommendation(projectSemanticState({
      stock_status: "INSUFFICIENT_DATA",
      usable_quantity: 0,
      forecast_daily_demand: null,
      last_true_issue_at: null
    }), true);
    expect(p.availability_status).toBe("OUT_OF_STOCK");
    expect(p.recommended_review_action).toBe("TRANSFER_REVIEW");
  });

  it("B1 preserves expiry signal from direct time evidence without inventing wastage", () => {
    const p = projectSemanticState({
      stock_status: "EXPIRY_RISK",
      usable_quantity: 40,
      near_expiry_quantity: 40,
      highest_expiry_risk: "CRITICAL",
      forecast_daily_demand: null,
      last_true_issue_at: null,
      expiry_quantity_at_risk: null,
      expiry_value_at_risk: null
    });
    expect(p.availability_status).toBe("HEALTHY");
    expect(p.expiry_status).toBe("CRITICAL");
    expect(p.expiry_evidence_basis).toBe("TIME_WINDOW_ONLY");
    expect(p.evidence_confidence).toBe("INSUFFICIENT_DATA");
    expect(p.recommended_review_action).toBe("FEFO_REVIEW");
    expect(p.suppress_expected_wastage_claims).toBe(true);
  });

  it("does not create expiry risk where no direct expiry signal exists", () => {
    const p = projectSemanticState({
      stock_status: "HEALTHY",
      usable_quantity: 10,
      near_expiry_quantity: 0,
      highest_expiry_risk: null,
      forecast_daily_demand: 1,
      last_true_issue_at: "2026-09-05"
    });
    expect(p.expiry_status).toBe("NONE");
    expect(p.expiry_evidence_basis).toBe("NONE");
    expect(p.suppress_expected_wastage_claims).toBe(false);
  });
});
