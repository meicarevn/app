import { approvedCohort } from "./intelligence-v4-011-canary";

type Row = Record<string, unknown>;

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hydratePromotedDbRows(rows: Row[], drugs: Row[], warehouses: Row[]) {
  const drugById = new Map(drugs.map((row) => [String(row.id || ""), row]));
  const warehouseById = new Map(warehouses.map((row) => [String(row.id || ""), row]));

  return rows.map((row) => {
    const usable = Math.max(0, numeric(row.usable_quantity));
    const orgUsable = Math.max(0, numeric(row.organization_usable_quantity));
    return {
      ...row,
      approved_semantic_cohort: approvedCohort(row),
      stock_elsewhere: orgUsable - usable > 0,
      drugs: drugById.get(String(row.drug_id || "")) || null,
      warehouses: warehouseById.get(String(row.warehouse_id || "")) || null
    };
  });
}

export function summarizePromotedDbRows(rows: Row[]) {
  const countBy = (key: string) => rows.reduce<Record<string, number>>((acc, row) => {
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
      wastage_claims_suppressed: b1.filter((row) => row.suppress_expected_wastage_claims === true).length
    },
    human_review_recommendations: rows.filter((row) => row.recommendation_requires_human_review === true).length,
    recommendations_without_human_review: rows.filter((row) => row.recommendation_state !== "NONE" && row.recommendation_requires_human_review !== true).length
  };
}

export function promotedMetadataComplete(rows: Row[]) {
  return rows.every((row) => row.drugs && row.warehouses);
}
