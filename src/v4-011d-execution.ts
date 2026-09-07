type Row = Record<string, unknown>;

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function key(row: Row) {
  return `${String(row.warehouse_id || "")}:${String(row.drug_id || "")}`;
}

export function approvedCohort(row: Row) {
  const legacy = String(row.legacy_v4_stock_status ?? "").toUpperCase();
  const usable = n(row.usable_quantity);
  if (legacy === "INSUFFICIENT_DATA" && usable <= 0) return "A1";
  if (legacy === "EXPIRY_RISK" && String(row.expiry_state || "NONE") !== "NONE") return "B1";
  return "NONE";
}

export function decoratePromotedDbRows(dbRows: Row[], metadataRows: Row[]) {
  const metadata = new Map(metadataRows.map((row) => [key(row), row]));
  return dbRows.map((row) => {
    const meta = metadata.get(key(row)) || {};
    const usable = Math.max(0, n(row.usable_quantity));
    const orgUsable = Math.max(0, n(row.organization_usable_quantity));
    return {
      ...row,
      approved_semantic_cohort: approvedCohort(row),
      stock_elsewhere: orgUsable - usable > 0,
      stock_status: row.legacy_v4_stock_status ?? null,
      risk_score: row.legacy_v4_risk_score ?? null,
      risk_components: row.legacy_v4_risk_components ?? null,
      recommendation_basis: row.legacy_v4_recommendation_basis ?? null,
      drugs: meta.drugs ?? null,
      warehouses: meta.warehouses ?? null
    };
  });
}

export function summarizePromotedDbRows(rows: Row[]) {
  const countBy = (field: string) => rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row[field] ?? "UNKNOWN");
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
    human_review_recommendations: rows.filter((row) => row.recommendation_requires_human_review === true).length
  };
}
