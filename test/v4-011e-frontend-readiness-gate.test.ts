import { describe, expect, it } from "vitest";
import {
  evaluateV4011EFrontendReadinessGate,
  type V4011EFrontendReadinessGateInput
} from "../src/v4-011e-frontend-readiness-gate";

const currentBaseline: V4011EFrontendReadinessGateInput = {
  v4_011d_authenticated_acceptance_pass: true,
  projection_rows: 2244,
  ledger_drift_rows: 0,
  semantic_regression_rows: 0,
  unsafe_recommendations: 0,
  auth_contract_pass: true,
  rls_contract_pass: true,
  service_role_exposure_count: 0,
  global_production_route_unchanged: true,
  rollback_evidence_present: true,
  backup_restore_verified: false,
  backup_restore_evidence: null,
  legacy_authenticated_security_definer_count: 13,
  leaked_password_protection_enabled: false,
  security_debt_risk_accepted: false,
  security_debt_risk_acceptance_evidence: null,
  last_v4_primary_gate_passed: false,
  last_v4_primary_blocking_failure_count: 4,
  cutover_stage: "SHADOW",
  inventory_write_mode: "LEGACY",
  alert_publish_mode: "SHADOW",
  his_ingestion_mode: "HYBRID",
  frontend_v4_ready: false,
  founder_a_approved: false,
  founder_a_approval_evidence: null
};

describe("V4_011E global frontend readiness promotion gate", () => {
  it("represents the current production baseline as blocked", () => {
    const decision = evaluateV4011EFrontendReadinessGate(currentBaseline);
    expect(decision.decision).toBe("BLOCKED");
    expect(decision.blockers).toContain("BACKUP_RESTORE_EVIDENCE_REQUIRED");
    expect(decision.blockers).toContain("SECURITY_DEBT_REMEDIATION_OR_RISK_ACCEPTANCE_REQUIRED");
    expect(decision.blockers).toContain("FOUNDER_A_APPROVAL_REQUIRED");
    expect(decision.warnings).toContain("V4_PRIMARY_GATE_STILL_FAILED");
    expect(decision.global_production_mutation_authorized).toBe(false);
  });

  it("blocks Founder A approval without durable evidence", () => {
    const decision = evaluateV4011EFrontendReadinessGate({
      ...currentBaseline,
      backup_restore_verified: true,
      backup_restore_evidence: "restore drill evidence",
      legacy_authenticated_security_definer_count: 0,
      leaked_password_protection_enabled: true,
      founder_a_approved: true
    });
    expect(decision.blockers).toContain("FOUNDER_A_APPROVAL_EVIDENCE_REQUIRED");
  });

  it("can become ready when mandatory evidence exists and security debt is remediated", () => {
    const decision = evaluateV4011EFrontendReadinessGate({
      ...currentBaseline,
      backup_restore_verified: true,
      backup_restore_evidence: "restore drill evidence",
      legacy_authenticated_security_definer_count: 0,
      leaked_password_protection_enabled: true,
      founder_a_approved: true,
      founder_a_approval_evidence: "Founder A approval evidence"
    });
    expect(decision.decision).toBe("READY_FOR_SEPARATE_CONTROLLED_GLOBAL_FRONTEND_PROMOTION");
    expect(decision.blockers).toEqual([]);
    expect(decision.warnings).toContain("V4_PRIMARY_GATE_STILL_FAILED");
    expect(decision.global_production_mutation_authorized).toBe(false);
  });

  it("allows explicit scoped security-risk acceptance only with durable evidence", () => {
    const decision = evaluateV4011EFrontendReadinessGate({
      ...currentBaseline,
      backup_restore_verified: true,
      backup_restore_evidence: "restore drill evidence",
      security_debt_risk_accepted: true,
      security_debt_risk_acceptance_evidence: "Founder A scoped risk acceptance",
      founder_a_approved: true,
      founder_a_approval_evidence: "Founder A promotion approval evidence"
    });
    expect(decision.decision).toBe("READY_FOR_SEPARATE_CONTROLLED_GLOBAL_FRONTEND_PROMOTION");
    expect(decision.warnings).toContain("SECURITY_DEBT_EXPLICITLY_ACCEPTED_FOR_FRONTEND_PROMOTION_SCOPE");
    expect(decision.warnings).toContain("LEGACY_AUTHENTICATED_SECURITY_DEFINER_EXPOSURE_REMAINS");
    expect(decision.warnings).toContain("LEAKED_PASSWORD_PROTECTION_REMAINS_DISABLED");
  });

  it("fails closed on data, semantic, auth, RLS or service-role regression", () => {
    const decision = evaluateV4011EFrontendReadinessGate({
      ...currentBaseline,
      ledger_drift_rows: 1,
      semantic_regression_rows: 1,
      unsafe_recommendations: 1,
      auth_contract_pass: false,
      rls_contract_pass: false,
      service_role_exposure_count: 1
    });
    expect(decision.blockers).toContain("INVENTORY_LEDGER_DRIFT_PRESENT");
    expect(decision.blockers).toContain("SEMANTIC_REGRESSION_PRESENT");
    expect(decision.blockers).toContain("UNSAFE_RECOMMENDATIONS_PRESENT");
    expect(decision.blockers).toContain("AUTH_CONTRACT_REGRESSION");
    expect(decision.blockers).toContain("RLS_CONTRACT_REGRESSION");
    expect(decision.blockers).toContain("SERVICE_ROLE_EXPOSURE_PRESENT");
  });

  it("fails closed if preparation touches the global route or lacks rollback evidence", () => {
    const decision = evaluateV4011EFrontendReadinessGate({
      ...currentBaseline,
      global_production_route_unchanged: false,
      rollback_evidence_present: false
    });
    expect(decision.blockers).toContain("GLOBAL_PRODUCTION_ROUTE_CHANGED_DURING_PREPARATION");
    expect(decision.blockers).toContain("ROUTE_ROLLBACK_EVIDENCE_REQUIRED");
  });

  it("blocks premature frontend readiness and non-frontend runtime cutovers", () => {
    const decision = evaluateV4011EFrontendReadinessGate({
      ...currentBaseline,
      frontend_v4_ready: true,
      inventory_write_mode: "V4",
      alert_publish_mode: "V4"
    });
    expect(decision.blockers).toContain("FRONTEND_V4_READY_CHANGED_BEFORE_PROMOTION");
    expect(decision.blockers).toContain("INVENTORY_WRITE_MODE_CHANGED");
    expect(decision.blockers).toContain("ALERT_PUBLISH_MODE_CHANGED");
  });
});
