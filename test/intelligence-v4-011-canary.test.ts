import { describe, expect, it } from "vitest";
import { approvedCohort, compareMultiAxisReadPaths, summarizeDbProjection } from "../src/intelligence-v4-011-canary";

describe("V4_011C controlled read-path canary", () => {
  const dbRows = [
    {
      organization_id: "o1", warehouse_id: "w1", drug_id: "d1", quantity_on_hand: 0, usable_quantity: 0,
      availability_state: "OUT_OF_STOCK", expiry_state: "NONE", evidence_state: "INSUFFICIENT_DATA",
      recommendation_state: "TRANSFER_REVIEW", expiry_evidence_mode: "NONE",
      recommendation_requires_human_review: true, suppress_expected_wastage_claims: false,
      legacy_v4_stock_status: "INSUFFICIENT_DATA"
    },
    {
      organization_id: "o1", warehouse_id: "w2", drug_id: "d2", quantity_on_hand: 8, usable_quantity: 8,
      availability_state: "HEALTHY", expiry_state: "HIGH", evidence_state: "INSUFFICIENT_DATA",
      recommendation_state: "FEFO_REVIEW", expiry_evidence_mode: "TIME_WINDOW_ONLY",
      recommendation_requires_human_review: true, suppress_expected_wastage_claims: true,
      legacy_v4_stock_status: "EXPIRY_RISK"
    }
  ];

  it("accepts exact semantic parity across the DB and Cloudflare paths", () => {
    const cloudRows = dbRows.map((row) => ({ ...row, stock_status: row.legacy_v4_stock_status }));
    const parity = compareMultiAxisReadPaths(dbRows, cloudRows);
    expect(parity.exact_parity).toBe(true);
    expect(parity.rows_with_mismatch).toBe(0);
    expect(parity.missing_in_db).toBe(0);
    expect(parity.missing_in_cloud).toBe(0);
  });

  it("surfaces semantic mismatch instead of normalizing it away", () => {
    const cloudRows = dbRows.map((row) => ({ ...row, stock_status: row.legacy_v4_stock_status }));
    cloudRows[1].recommendation_state = "NONE";
    const parity = compareMultiAxisReadPaths(dbRows, cloudRows);
    expect(parity.exact_parity).toBe(false);
    expect(parity.rows_with_mismatch).toBe(1);
    expect(parity.mismatch_by_field.recommendation_state).toBe(1);
    expect(parity.sample_mismatches.length).toBe(1);
  });

  it("classifies only the approved A1/B1 cohorts for canary reporting", () => {
    expect(approvedCohort(dbRows[0])).toBe("A1");
    expect(approvedCohort(dbRows[1])).toBe("B1");
    expect(approvedCohort({ legacy_v4_stock_status: "OUT_OF_STOCK", usable_quantity: 0, expiry_state: "NONE" })).toBe("NONE");
  });

  it("summarizes DB projection and preserves the human-review gate", () => {
    const summary = summarizeDbProjection(dbRows);
    expect(summary.rows).toBe(2);
    expect(summary.a1.total).toBe(1);
    expect(summary.a1.transfer_review).toBe(1);
    expect(summary.b1.total).toBe(1);
    expect(summary.b1.high).toBe(1);
    expect(summary.b1.time_window_only).toBe(1);
    expect(summary.recommendations_without_human_review).toBe(0);
  });
});
