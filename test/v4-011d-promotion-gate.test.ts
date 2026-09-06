import { describe, expect, it } from "vitest";
import { evaluateV4011DPromotionGate, type V4011DGateInput } from "../src/v4-011d-promotion-gate";

const accepted: V4011DGateInput = {
  authenticated_canary_pass: true,
  exact_parity: true,
  parity_mismatch_rows: 0,
  missing_db_rows: 0,
  missing_cloudflare_rows: 0,
  unsafe_recommendations: 0,
  projection_rows: 2244,
  ledger_drift_rows: 0,
  cutover_stage: "SHADOW",
  inventory_write_mode: "LEGACY",
  alert_publish_mode: "SHADOW",
  his_ingestion_mode: "HYBRID",
  frontend_v4_ready: false,
  integration_layer_ready: false,
  r2_gateway_ready: false,
  iot_gateway_ready: false,
  ai_orchestrator_ready: false,
  founder_a_approved: false,
  founder_a_approval_evidence: null
};

describe("V4_011D controlled read-path promotion gate", () => {
  it("blocks even with perfect canary evidence when Founder A approval is absent", () => {
    const decision = evaluateV4011DPromotionGate(accepted);
    expect(decision.decision).toBe("BLOCKED");
    expect(decision.blockers).toContain("FOUNDER_A_APPROVAL_REQUIRED");
    expect(decision.production_mutation_authorized).toBe(false);
  });

  it("requires durable Founder A approval evidence when approval is asserted", () => {
    const decision = evaluateV4011DPromotionGate({ ...accepted, founder_a_approved: true });
    expect(decision.decision).toBe("BLOCKED");
    expect(decision.blockers).toContain("FOUNDER_A_APPROVAL_EVIDENCE_REQUIRED");
  });

  it("can become ready for a separate controlled promotion only with approval evidence and all invariants", () => {
    const decision = evaluateV4011DPromotionGate({
      ...accepted,
      founder_a_approved: true,
      founder_a_approval_evidence: "GitHub review/issue evidence"
    });
    expect(decision.decision).toBe("READY_FOR_CONTROLLED_PROMOTION");
    expect(decision.blockers).toEqual([]);
    expect(decision.production_mutation_authorized).toBe(false);
  });

  it("fails closed on any parity regression", () => {
    const decision = evaluateV4011DPromotionGate({
      ...accepted,
      founder_a_approved: true,
      founder_a_approval_evidence: "evidence",
      exact_parity: false,
      parity_mismatch_rows: 1
    });
    expect(decision.decision).toBe("BLOCKED");
    expect(decision.blockers).toContain("EXACT_READ_PATH_PARITY_REQUIRED");
    expect(decision.blockers).toContain("PARITY_MISMATCH_ROWS_PRESENT");
  });

  it("fails closed on ledger drift or unexpected runtime cutover", () => {
    const decision = evaluateV4011DPromotionGate({
      ...accepted,
      founder_a_approved: true,
      founder_a_approval_evidence: "evidence",
      ledger_drift_rows: 1,
      cutover_stage: "V4_PRIMARY"
    });
    expect(decision.decision).toBe("BLOCKED");
    expect(decision.blockers).toContain("INVENTORY_LEDGER_DRIFT_PRESENT");
    expect(decision.blockers).toContain("CUTOVER_STAGE_NOT_SHADOW");
  });

  it("blocks if frontend readiness changed before this gate", () => {
    const decision = evaluateV4011DPromotionGate({
      ...accepted,
      founder_a_approved: true,
      founder_a_approval_evidence: "evidence",
      frontend_v4_ready: true
    });
    expect(decision.decision).toBe("BLOCKED");
    expect(decision.blockers).toContain("FRONTEND_V4_READY_CHANGED_BEFORE_GATE");
  });
});
