import { describe, expect, it } from "vitest";
import { projectMultiAxisRows, projectMultiAxisState, summarizeMultiAxis } from "../src/intelligence-v4-011";

describe("V4_011 multi-axis intelligence", () => {
  it("keeps A1 stockout factual while demand evidence stays insufficient", () => {
    const p = projectMultiAxisState({
      stock_status: "INSUFFICIENT_DATA",
      usable_quantity: 0,
      forecast_daily_demand: null,
      last_true_issue_at: null,
      reference_stock: 100
    }, 0);

    expect(p.availability_state).toBe("OUT_OF_STOCK");
    expect(p.evidence_state).toBe("INSUFFICIENT_DATA");
    expect(p.recommendation_state).toBe("PROCUREMENT_REVIEW");
    expect(p.approved_semantic_cohort).toBe("A1");
    expect(p.recommendation_requires_human_review).toBe(true);
  });

  it("routes approved A1 to transfer review only when usable stock exists elsewhere", () => {
    const p = projectMultiAxisState({
      stock_status: "INSUFFICIENT_DATA",
      usable_quantity: 0,
      forecast_daily_demand: null,
      last_true_issue_at: null,
      reference_stock: 50
    }, 20);

    expect(p.availability_state).toBe("OUT_OF_STOCK");
    expect(p.stock_elsewhere).toBe(true);
    expect(p.recommendation_state).toBe("TRANSFER_REVIEW");
  });

  it("does not silently generalize A1 recommendation semantics to legacy stockout rows", () => {
    const p = projectMultiAxisState({
      stock_status: "OUT_OF_STOCK",
      usable_quantity: 0,
      forecast_daily_demand: null,
      last_true_issue_at: null,
      reference_stock: 50
    }, 20);

    expect(p.availability_state).toBe("OUT_OF_STOCK");
    expect(p.approved_semantic_cohort).toBe("NONE");
    expect(p.recommendation_state).toBe("NONE");
  });

  it("preserves B1 expiry severity and suppresses expected-wastage claims without demand evidence", () => {
    const p = projectMultiAxisState({
      stock_status: "EXPIRY_RISK",
      usable_quantity: 40,
      highest_expiry_risk: "HIGH",
      near_expiry_quantity: 40,
      forecast_daily_demand: null,
      last_true_issue_at: null,
      reference_stock: 60,
      expiry_quantity_at_risk: 0,
      expiry_value_at_risk: 0
    }, 40);

    expect(p.availability_state).toBe("HEALTHY");
    expect(p.expiry_state).toBe("HIGH");
    expect(p.expiry_evidence_mode).toBe("TIME_WINDOW_ONLY");
    expect(p.evidence_qualifiers).toContain("TIME_WINDOW_ONLY");
    expect(p.recommendation_state).toBe("FEFO_REVIEW");
    expect(p.suppress_expected_wastage_claims).toBe(true);
    expect(p.approved_semantic_cohort).toBe("B1");
  });

  it("keeps availability and expiry axes independent", () => {
    const p = projectMultiAxisState({
      stock_status: "EXPIRY_RISK",
      usable_quantity: 10,
      highest_expiry_risk: "CRITICAL",
      near_expiry_quantity: 10,
      forecast_daily_demand: 1,
      last_true_issue_at: "2026-09-01",
      reference_stock: 20
    }, 10);

    expect(p.availability_state).toBe("HEALTHY");
    expect(p.expiry_state).toBe("CRITICAL");
    expect(p.evidence_state).toBe("SUFFICIENT");
    expect(p.expiry_evidence_mode).toBe("DEMAND_SUPPORTED");
  });

  it("summarizes accepted A1 and B1 cohorts without losing operational rows", () => {
    const projected = projectMultiAxisRows([
      { drug_id: "d1", warehouse_id: "w1", stock_status: "INSUFFICIENT_DATA", usable_quantity: 0, forecast_daily_demand: null, last_true_issue_at: null, reference_stock: 10 },
      { drug_id: "d1", warehouse_id: "w2", stock_status: "HEALTHY", usable_quantity: 5, forecast_daily_demand: null, last_true_issue_at: null, reference_stock: 10 },
      { drug_id: "d2", warehouse_id: "w1", stock_status: "EXPIRY_RISK", usable_quantity: 8, highest_expiry_risk: "WARNING", near_expiry_quantity: 8, forecast_daily_demand: null, last_true_issue_at: null, reference_stock: 10 }
    ]);
    const summary = summarizeMultiAxis(projected);

    expect(summary.rows).toBe(3);
    expect(summary.a1.total).toBe(1);
    expect(summary.a1.transfer_review).toBe(1);
    expect(summary.b1.total).toBe(1);
    expect(summary.b1.warning).toBe(1);
    expect(summary.b1.time_window_only).toBe(1);
    expect(summary.b1.wastage_claims_suppressed).toBe(1);
  });
});
