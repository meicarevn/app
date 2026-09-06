export type V4011DGateInput = {
  authenticated_canary_pass: boolean;
  exact_parity: boolean;
  parity_mismatch_rows: number;
  missing_db_rows: number;
  missing_cloudflare_rows: number;
  unsafe_recommendations: number;
  projection_rows: number;
  ledger_drift_rows: number;
  cutover_stage: string;
  inventory_write_mode: string;
  alert_publish_mode: string;
  his_ingestion_mode: string;
  frontend_v4_ready: boolean;
  integration_layer_ready: boolean;
  r2_gateway_ready: boolean;
  iot_gateway_ready: boolean;
  ai_orchestrator_ready: boolean;
  founder_a_approved: boolean;
  founder_a_approval_evidence?: string | null;
};

export type V4011DGateDecision = {
  gate: "V4_011D_CONTROLLED_READ_PATH_PROMOTION";
  decision: "BLOCKED" | "READY_FOR_CONTROLLED_PROMOTION";
  blockers: string[];
  warnings: string[];
  production_mutation_authorized: boolean;
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function nonNegative(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : Number.POSITIVE_INFINITY;
}

export function evaluateV4011DPromotionGate(input: V4011DGateInput): V4011DGateDecision {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!input.authenticated_canary_pass) blockers.push("AUTHENTICATED_CANARY_ACCEPTANCE_REQUIRED");
  if (!input.exact_parity) blockers.push("EXACT_READ_PATH_PARITY_REQUIRED");
  if (nonNegative(input.parity_mismatch_rows) !== 0) blockers.push("PARITY_MISMATCH_ROWS_PRESENT");
  if (nonNegative(input.missing_db_rows) !== 0) blockers.push("MISSING_DB_ROWS_PRESENT");
  if (nonNegative(input.missing_cloudflare_rows) !== 0) blockers.push("MISSING_CLOUDFLARE_ROWS_PRESENT");
  if (nonNegative(input.unsafe_recommendations) !== 0) blockers.push("UNSAFE_RECOMMENDATIONS_PRESENT");
  if (nonNegative(input.projection_rows) !== 2244) blockers.push("PROJECTION_ROW_COUNT_OUTSIDE_ACCEPTED_BASELINE");
  if (nonNegative(input.ledger_drift_rows) !== 0) blockers.push("INVENTORY_LEDGER_DRIFT_PRESENT");

  if (normalized(input.cutover_stage) !== "SHADOW") blockers.push("CUTOVER_STAGE_NOT_SHADOW");
  if (normalized(input.inventory_write_mode) !== "LEGACY") blockers.push("INVENTORY_WRITE_MODE_CHANGED");
  if (normalized(input.alert_publish_mode) !== "SHADOW") blockers.push("ALERT_PUBLISH_MODE_CHANGED");
  if (normalized(input.his_ingestion_mode) !== "HYBRID") blockers.push("HIS_INGESTION_MODE_CHANGED");

  if (input.frontend_v4_ready) blockers.push("FRONTEND_V4_READY_CHANGED_BEFORE_GATE");
  if (input.integration_layer_ready) warnings.push("INTEGRATION_LAYER_READY_CHANGED_OUTSIDE_V4_011D_SCOPE");
  if (input.r2_gateway_ready) warnings.push("R2_GATEWAY_READY_CHANGED_OUTSIDE_V4_011D_SCOPE");
  if (input.iot_gateway_ready) warnings.push("IOT_GATEWAY_READY_CHANGED_OUTSIDE_V4_011D_SCOPE");
  if (input.ai_orchestrator_ready) warnings.push("AI_ORCHESTRATOR_READY_CHANGED_OUTSIDE_V4_011D_SCOPE");

  const approvalEvidence = String(input.founder_a_approval_evidence ?? "").trim();
  if (!input.founder_a_approved) blockers.push("FOUNDER_A_APPROVAL_REQUIRED");
  if (input.founder_a_approved && !approvalEvidence) blockers.push("FOUNDER_A_APPROVAL_EVIDENCE_REQUIRED");

  const ready = blockers.length === 0;
  return {
    gate: "V4_011D_CONTROLLED_READ_PATH_PROMOTION",
    decision: ready ? "READY_FOR_CONTROLLED_PROMOTION" : "BLOCKED",
    blockers,
    warnings,
    // This evaluator never performs a production mutation. A READY decision only
    // means the recorded evidence is sufficient for a separately executed,
    // explicitly approved controlled promotion step.
    production_mutation_authorized: false
  };
}
