export type V4011EFrontendReadinessGateInput = {
  v4_011d_authenticated_acceptance_pass: boolean;
  projection_rows: number;
  ledger_drift_rows: number;
  semantic_regression_rows: number;
  unsafe_recommendations: number;
  auth_contract_pass: boolean;
  rls_contract_pass: boolean;
  service_role_exposure_count: number;
  global_production_route_unchanged: boolean;
  rollback_evidence_present: boolean;
  backup_restore_verified: boolean;
  backup_restore_evidence?: string | null;
  legacy_authenticated_security_definer_count: number;
  leaked_password_protection_enabled: boolean;
  security_debt_risk_accepted: boolean;
  security_debt_risk_acceptance_evidence?: string | null;
  last_v4_primary_gate_passed: boolean;
  last_v4_primary_blocking_failure_count: number;
  cutover_stage: string;
  inventory_write_mode: string;
  alert_publish_mode: string;
  his_ingestion_mode: string;
  frontend_v4_ready: boolean;
  founder_a_approved: boolean;
  founder_a_approval_evidence?: string | null;
};

export type V4011EFrontendReadinessGateDecision = {
  gate: "V4_011E_GLOBAL_FRONTEND_READINESS_PROMOTION";
  decision: "BLOCKED" | "READY_FOR_SEPARATE_CONTROLLED_GLOBAL_FRONTEND_PROMOTION";
  blockers: string[];
  warnings: string[];
  risk_acceptance_requirements: string[];
  global_production_mutation_authorized: boolean;
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function nonNegative(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : Number.POSITIVE_INFINITY;
}

function hasEvidence(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

export function evaluateV4011EFrontendReadinessGate(
  input: V4011EFrontendReadinessGateInput
): V4011EFrontendReadinessGateDecision {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const riskAcceptanceRequirements: string[] = [];

  if (!input.v4_011d_authenticated_acceptance_pass) {
    blockers.push("V4_011D_AUTHENTICATED_ACCEPTANCE_REQUIRED");
  }
  if (nonNegative(input.projection_rows) !== 2244) {
    blockers.push("PROJECTION_ROW_COUNT_OUTSIDE_ACCEPTED_BASELINE");
  }
  if (nonNegative(input.ledger_drift_rows) !== 0) {
    blockers.push("INVENTORY_LEDGER_DRIFT_PRESENT");
  }
  if (nonNegative(input.semantic_regression_rows) !== 0) {
    blockers.push("SEMANTIC_REGRESSION_PRESENT");
  }
  if (nonNegative(input.unsafe_recommendations) !== 0) {
    blockers.push("UNSAFE_RECOMMENDATIONS_PRESENT");
  }
  if (!input.auth_contract_pass) blockers.push("AUTH_CONTRACT_REGRESSION");
  if (!input.rls_contract_pass) blockers.push("RLS_CONTRACT_REGRESSION");
  if (nonNegative(input.service_role_exposure_count) !== 0) {
    blockers.push("SERVICE_ROLE_EXPOSURE_PRESENT");
  }
  if (!input.global_production_route_unchanged) {
    blockers.push("GLOBAL_PRODUCTION_ROUTE_CHANGED_DURING_PREPARATION");
  }
  if (!input.rollback_evidence_present) blockers.push("ROUTE_ROLLBACK_EVIDENCE_REQUIRED");

  const backupEvidence = hasEvidence(input.backup_restore_evidence);
  if (!input.backup_restore_verified || !backupEvidence) {
    blockers.push("BACKUP_RESTORE_EVIDENCE_REQUIRED");
  }

  const legacySecurityDefiners = nonNegative(input.legacy_authenticated_security_definer_count);
  const securityDebtPresent = legacySecurityDefiners !== 0 || !input.leaked_password_protection_enabled;
  const riskEvidence = hasEvidence(input.security_debt_risk_acceptance_evidence);
  if (securityDebtPresent) {
    riskAcceptanceRequirements.push("SECURITY_DEBT_REMEDIATION_OR_EXPLICIT_FOUNDER_A_RISK_ACCEPTANCE");
    if (!input.security_debt_risk_accepted || !riskEvidence) {
      blockers.push("SECURITY_DEBT_REMEDIATION_OR_RISK_ACCEPTANCE_REQUIRED");
    } else {
      warnings.push("SECURITY_DEBT_EXPLICITLY_ACCEPTED_FOR_FRONTEND_PROMOTION_SCOPE");
      if (legacySecurityDefiners !== 0) {
        warnings.push("LEGACY_AUTHENTICATED_SECURITY_DEFINER_EXPOSURE_REMAINS");
      }
      if (!input.leaked_password_protection_enabled) {
        warnings.push("LEAKED_PASSWORD_PROTECTION_REMAINS_DISABLED");
      }
    }
  }

  if (!input.last_v4_primary_gate_passed) {
    warnings.push("V4_PRIMARY_GATE_STILL_FAILED");
  }
  if (nonNegative(input.last_v4_primary_blocking_failure_count) !== 0) {
    warnings.push("V4_PRIMARY_GATE_HAS_BLOCKING_FAILURES");
  }

  if (normalized(input.cutover_stage) !== "SHADOW") blockers.push("CUTOVER_STAGE_NOT_SHADOW");
  if (normalized(input.inventory_write_mode) !== "LEGACY") blockers.push("INVENTORY_WRITE_MODE_CHANGED");
  if (normalized(input.alert_publish_mode) !== "SHADOW") blockers.push("ALERT_PUBLISH_MODE_CHANGED");
  if (normalized(input.his_ingestion_mode) !== "HYBRID") blockers.push("HIS_INGESTION_MODE_CHANGED");
  if (input.frontend_v4_ready) blockers.push("FRONTEND_V4_READY_CHANGED_BEFORE_PROMOTION");

  const approvalEvidence = hasEvidence(input.founder_a_approval_evidence);
  if (!input.founder_a_approved) blockers.push("FOUNDER_A_APPROVAL_REQUIRED");
  if (input.founder_a_approved && !approvalEvidence) {
    blockers.push("FOUNDER_A_APPROVAL_EVIDENCE_REQUIRED");
  }

  const ready = blockers.length === 0;
  return {
    gate: "V4_011E_GLOBAL_FRONTEND_READINESS_PROMOTION",
    decision: ready ? "READY_FOR_SEPARATE_CONTROLLED_GLOBAL_FRONTEND_PROMOTION" : "BLOCKED",
    blockers,
    warnings,
    risk_acceptance_requirements: riskAcceptanceRequirements,
    // This evaluator never deploys the global frontend and never flips readiness.
    // READY means only that a separately executed, explicitly approved controlled
    // promotion step may be prepared with its own deploy/smoke/rollback evidence.
    global_production_mutation_authorized: false
  };
}
