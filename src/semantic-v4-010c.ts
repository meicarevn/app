export type SemanticInput = {
  stock_status?: string | null;
  usable_quantity?: number | string | null;
  forecast_daily_demand?: number | string | null;
  last_true_issue_at?: string | null;
  highest_expiry_risk?: string | null;
  near_expiry_quantity?: number | string | null;
  expiry_quantity_at_risk?: number | string | null;
  expiry_value_at_risk?: number | string | null;
};

export type SemanticProjection = {
  semantic_model_version: "V4_010C_A1_B1";
  engine_stock_status: string | null;
  availability_status: "OUT_OF_STOCK" | "LOW" | "HEALTHY" | "OVERSTOCK" | "UNKNOWN";
  evidence_confidence: "INSUFFICIENT_DATA" | "LIMITED" | "SUFFICIENT";
  expiry_status: "CRITICAL" | "HIGH" | "WARNING" | "NONE";
  expiry_evidence_basis: "TIME_WINDOW_ONLY" | "DEMAND_SUPPORTED" | "NONE";
  recommended_review_action: "TRANSFER_REVIEW" | "PROCUREMENT_REVIEW" | "FEFO_REVIEW" | "NONE";
  suppress_expected_wastage_claims: boolean;
};

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function projectSemanticState(input: SemanticInput): SemanticProjection {
  const usable = n(input.usable_quantity);
  const demandMissing = input.forecast_daily_demand == null && !input.last_true_issue_at;
  const engine = input.stock_status ?? null;

  let availability: SemanticProjection["availability_status"] = "UNKNOWN";
  if (usable <= 0) availability = "OUT_OF_STOCK";
  else if (engine === "OVERSTOCK") availability = "OVERSTOCK";
  else if (["CRITICAL", "REORDER", "DEFAULT_LOW_STOCK", "LOW_STOCK"].includes(String(engine))) availability = "LOW";
  else if (usable > 0) availability = "HEALTHY";

  const expiryRaw = String(input.highest_expiry_risk || "").toUpperCase();
  const expiry: SemanticProjection["expiry_status"] = ["CRITICAL", "HIGH", "WARNING"].includes(expiryRaw)
    ? expiryRaw as SemanticProjection["expiry_status"]
    : n(input.near_expiry_quantity) > 0 || engine === "EXPIRY_RISK"
      ? "WARNING"
      : "NONE";

  const expiryPresent = expiry !== "NONE";
  const evidence: SemanticProjection["evidence_confidence"] = demandMissing
    ? "INSUFFICIENT_DATA"
    : expiryPresent && input.expiry_quantity_at_risk == null
      ? "LIMITED"
      : "SUFFICIENT";

  return {
    semantic_model_version: "V4_010C_A1_B1",
    engine_stock_status: engine,
    availability_status: availability,
    evidence_confidence: evidence,
    expiry_status: expiry,
    expiry_evidence_basis: expiryPresent ? (demandMissing ? "TIME_WINDOW_ONLY" : "DEMAND_SUPPORTED") : "NONE",
    recommended_review_action: usable <= 0 ? "PROCUREMENT_REVIEW" : expiryPresent ? "FEFO_REVIEW" : "NONE",
    suppress_expected_wastage_claims: expiryPresent && demandMissing
  };
}

export function withTransferRecommendation<T extends SemanticProjection>(projection: T, stockElsewhere: boolean): T {
  if (projection.availability_status === "OUT_OF_STOCK" && stockElsewhere) {
    return { ...projection, recommended_review_action: "TRANSFER_REVIEW" };
  }
  return projection;
}
