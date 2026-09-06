export type MultiAxisInput = {
  organization_id?: string | null;
  warehouse_id?: string | null;
  drug_id?: string | null;
  quantity_on_hand?: number | string | null;
  usable_quantity?: number | string | null;
  quantity_reserved?: number | string | null;
  quantity_quarantined?: number | string | null;
  quantity_rejected?: number | string | null;
  nearest_expiry?: string | null;
  forecast_daily_demand?: number | string | null;
  demand_confidence_level?: string | null;
  last_true_issue_at?: string | null;
  reference_stock?: number | string | null;
  reference_basis?: string | null;
  suggested_target_stock?: number | string | null;
  recommended_order_quantity?: number | string | null;
  data_quality_score?: number | string | null;
  unpriced_lot_count?: number | string | null;
  highest_expiry_risk?: string | null;
  near_expiry_quantity?: number | string | null;
  expiry_quantity_at_risk?: number | string | null;
  expiry_value_at_risk?: number | string | null;
  stock_status?: string | null;
  recommendation_basis?: string | null;
  calculated_at?: string | null;
  drugs?: Record<string, unknown> | null;
  warehouses?: Record<string, unknown> | null;
};

export type AvailabilityState =
  | "OUT_OF_STOCK"
  | "CRITICAL"
  | "REORDER"
  | "HEALTHY"
  | "OVERSTOCK"
  | "INSUFFICIENT_REFERENCE";

export type ExpiryState = "CRITICAL" | "HIGH" | "WARNING" | "NONE";
export type EvidenceState = "SUFFICIENT" | "LIMITED" | "INSUFFICIENT_DATA";
export type RecommendationState =
  | "TRANSFER_REVIEW"
  | "PROCUREMENT_REVIEW"
  | "FEFO_REVIEW"
  | "POLICY_REVIEW"
  | "DATA_REVIEW"
  | "NONE";

export type MultiAxisProjection = {
  model_version: "V4_011_MULTI_AXIS";
  availability_state: AvailabilityState;
  availability_reason_codes: string[];
  expiry_state: ExpiryState;
  expiry_reason_codes: string[];
  expiry_evidence_mode: "TIME_WINDOW_ONLY" | "DEMAND_SUPPORTED" | "NONE";
  evidence_state: EvidenceState;
  evidence_qualifiers: string[];
  recommendation_state: RecommendationState;
  recommendation_reason_codes: string[];
  recommendation_requires_human_review: boolean;
  suppress_expected_wastage_claims: boolean;
  approved_semantic_cohort: "A1" | "B1" | "NONE";
  organization_usable_quantity: number;
  stock_elsewhere: boolean;
};

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function projectMultiAxisState(
  input: MultiAxisInput,
  organizationUsableQuantity: number
): MultiAxisProjection {
  const usable = n(input.usable_quantity);
  const engineStatus = text(input.stock_status);
  const orgUsable = Math.max(0, n(organizationUsableQuantity));
  const stockElsewhere = orgUsable - Math.max(0, usable) > 0;
  const demandMissing = input.forecast_daily_demand == null && !input.last_true_issue_at;
  const referenceMissing = input.reference_stock == null && !input.reference_basis;

  let availability: AvailabilityState;
  const availabilityReasons: string[] = [];
  if (usable <= 0) {
    availability = "OUT_OF_STOCK";
    availabilityReasons.push("USABLE_QUANTITY_ZERO_OR_NEGATIVE");
  } else if (engineStatus === "OVERSTOCK") {
    availability = "OVERSTOCK";
    availabilityReasons.push("LEGACY_V4_OVERSTOCK_SIGNAL");
  } else if (engineStatus === "CRITICAL") {
    availability = "CRITICAL";
    availabilityReasons.push("LEGACY_V4_CRITICAL_THRESHOLD");
  } else if (["REORDER", "DEFAULT_LOW_STOCK", "LOW_STOCK"].includes(engineStatus)) {
    availability = "REORDER";
    availabilityReasons.push("LEGACY_V4_REORDER_THRESHOLD");
  } else if (referenceMissing || engineStatus === "INSUFFICIENT_DATA") {
    availability = "INSUFFICIENT_REFERENCE";
    availabilityReasons.push(referenceMissing ? "MISSING_POLICY_REFERENCE" : "LEGACY_V4_REFERENCE_INSUFFICIENT");
  } else {
    availability = "HEALTHY";
    availabilityReasons.push("POSITIVE_USABLE_QUANTITY_WITHOUT_LOW_STOCK_SIGNAL");
  }

  const rawExpiry = text(input.highest_expiry_risk);
  let expiry: ExpiryState = "NONE";
  const expiryReasons: string[] = [];
  if (["CRITICAL", "HIGH", "WARNING"].includes(rawExpiry)) {
    expiry = rawExpiry as ExpiryState;
    expiryReasons.push("DIRECT_EXPIRY_WINDOW_SIGNAL");
  } else if (n(input.near_expiry_quantity) > 0 || engineStatus === "EXPIRY_RISK") {
    expiry = "WARNING";
    expiryReasons.push("DIRECT_NEAR_EXPIRY_EVIDENCE");
  }

  const evidenceQualifiers: string[] = [];
  if (input.forecast_daily_demand == null) evidenceQualifiers.push("NO_FINALIZED_DEMAND_HISTORY");
  if (!input.last_true_issue_at) evidenceQualifiers.push("NO_TRUE_ISSUE_HISTORY");
  if (referenceMissing) evidenceQualifiers.push("MISSING_POLICY_REFERENCE");
  if (n(input.unpriced_lot_count) > 0) evidenceQualifiers.push("MISSING_UNIT_COST");
  if (expiry !== "NONE" && demandMissing) evidenceQualifiers.push("TIME_WINDOW_ONLY");

  const evidence: EvidenceState = demandMissing
    ? "INSUFFICIENT_DATA"
    : evidenceQualifiers.length > 0
      ? "LIMITED"
      : "SUFFICIENT";

  const isA1 = engineStatus === "INSUFFICIENT_DATA" && usable <= 0 && demandMissing;
  const isB1 = engineStatus === "EXPIRY_RISK" && expiry !== "NONE" && demandMissing;

  let recommendation: RecommendationState = "NONE";
  const recommendationReasons: string[] = [];

  // The first V4_011 Shadow release deliberately limits transfer/procurement
  // recommendations to the Founder B-approved A1 cohort. Extending the same
  // behavior to legacy OUT_OF_STOCK rows is a separate product/clinical decision.
  if (isA1) {
    if (stockElsewhere) {
      recommendation = "TRANSFER_REVIEW";
      recommendationReasons.push("A1_STOCKOUT_WITH_USABLE_STOCK_ELSEWHERE");
    } else {
      recommendation = "PROCUREMENT_REVIEW";
      recommendationReasons.push("A1_ORGANIZATION_WIDE_ZERO_USABLE_STOCK");
    }
  } else if (expiry !== "NONE") {
    recommendation = "FEFO_REVIEW";
    recommendationReasons.push("DIRECT_EXPIRY_RISK_REQUIRES_FEFO_REVIEW");
  } else if (availability === "INSUFFICIENT_REFERENCE") {
    recommendation = "POLICY_REVIEW";
    recommendationReasons.push("REFERENCE_OR_POLICY_EVIDENCE_INSUFFICIENT");
  }

  return {
    model_version: "V4_011_MULTI_AXIS",
    availability_state: availability,
    availability_reason_codes: availabilityReasons,
    expiry_state: expiry,
    expiry_reason_codes: expiryReasons,
    expiry_evidence_mode: expiry === "NONE" ? "NONE" : demandMissing ? "TIME_WINDOW_ONLY" : "DEMAND_SUPPORTED",
    evidence_state: evidence,
    evidence_qualifiers: evidenceQualifiers,
    recommendation_state: recommendation,
    recommendation_reason_codes: recommendationReasons,
    recommendation_requires_human_review: recommendation !== "NONE",
    suppress_expected_wastage_claims: expiry !== "NONE" && demandMissing,
    approved_semantic_cohort: isA1 ? "A1" : isB1 ? "B1" : "NONE",
    organization_usable_quantity: orgUsable,
    stock_elsewhere: stockElsewhere
  };
}

export function projectMultiAxisRows<T extends MultiAxisInput>(rows: T[]) {
  const usableByDrug = new Map<string, number>();
  for (const row of rows) {
    const drugId = String(row.drug_id || "");
    if (!drugId) continue;
    usableByDrug.set(drugId, (usableByDrug.get(drugId) || 0) + Math.max(0, n(row.usable_quantity)));
  }

  return rows.map((row) => ({
    ...row,
    ...projectMultiAxisState(row, usableByDrug.get(String(row.drug_id || "")) || 0),
    legacy_v4_stock_status: row.stock_status ?? null
  }));
}

export function summarizeMultiAxis(rows: Array<MultiAxisInput & MultiAxisProjection>) {
  const countBy = (key: keyof MultiAxisProjection) => rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row[key] ?? "UNKNOWN");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});

  const a1 = rows.filter((row) => row.approved_semantic_cohort === "A1");
  const b1 = rows.filter((row) => row.approved_semantic_cohort === "B1");

  return {
    model_version: "V4_011_MULTI_AXIS",
    rows: rows.length,
    availability: countBy("availability_state"),
    expiry: countBy("expiry_state"),
    evidence: countBy("evidence_state"),
    recommendation: countBy("recommendation_state"),
    a1: {
      total: a1.length,
      transfer_review: a1.filter((row) => row.recommendation_state === "TRANSFER_REVIEW").length,
      procurement_review: a1.filter((row) => row.recommendation_state === "PROCUREMENT_REVIEW").length,
      insufficient_data: a1.filter((row) => row.evidence_state === "INSUFFICIENT_DATA").length
    },
    b1: {
      total: b1.length,
      critical: b1.filter((row) => row.expiry_state === "CRITICAL").length,
      high: b1.filter((row) => row.expiry_state === "HIGH").length,
      warning: b1.filter((row) => row.expiry_state === "WARNING").length,
      time_window_only: b1.filter((row) => row.expiry_evidence_mode === "TIME_WINDOW_ONLY").length,
      wastage_claims_suppressed: b1.filter((row) => row.suppress_expected_wastage_claims).length
    },
    human_review_recommendations: rows.filter((row) => row.recommendation_requires_human_review).length
  };
}
