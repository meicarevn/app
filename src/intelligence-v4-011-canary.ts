type CanonicalRow = Record<string, unknown> & {
  organization_id?: string | null;
  warehouse_id?: string | null;
  drug_id?: string | null;
  quantity_on_hand?: number | string | null;
  usable_quantity?: number | string | null;
  availability_state?: string | null;
  expiry_state?: string | null;
  evidence_state?: string | null;
  recommendation_state?: string | null;
  expiry_evidence_mode?: string | null;
  recommendation_requires_human_review?: boolean | null;
  suppress_expected_wastage_claims?: boolean | null;
  legacy_v4_stock_status?: string | null;
  stock_status?: string | null;
};

const FIELDS = [
  "quantity_on_hand",
  "usable_quantity",
  "availability_state",
  "expiry_state",
  "evidence_state",
  "recommendation_state",
  "expiry_evidence_mode",
  "recommendation_requires_human_review",
  "suppress_expected_wastage_claims"
] as const;

function key(row: CanonicalRow) {
  return `${String(row.warehouse_id || "")}:${String(row.drug_id || "")}`;
}

function numeric(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function equal(field: typeof FIELDS[number], a: unknown, b: unknown) {
  if (field === "quantity_on_hand" || field === "usable_quantity") {
    return Math.abs(numeric(a) - numeric(b)) <= 0.000001;
  }
  return (a ?? null) === (b ?? null);
}

export function approvedCohort(row: CanonicalRow) {
  const legacy = String(row.legacy_v4_stock_status ?? row.stock_status ?? "").toUpperCase();
  const usable = numeric(row.usable_quantity);
  if (legacy === "INSUFFICIENT_DATA" && usable <= 0) return "A1";
  if (legacy === "EXPIRY_RISK" && String(row.expiry_state || "NONE") !== "NONE") return "B1";
  return "NONE";
}

export function summarizeDbProjection(rows: CanonicalRow[]) {
  const a1 = rows.filter((row) => approvedCohort(row) === "A1");
  const b1 = rows.filter((row) => approvedCohort(row) === "B1");
  return {
    rows: rows.length,
    quantity_on_hand_sum: rows.reduce((sum, row) => sum + numeric(row.quantity_on_hand), 0),
    a1: {
      total: a1.length,
      transfer_review: a1.filter((row) => row.recommendation_state === "TRANSFER_REVIEW").length,
      procurement_review: a1.filter((row) => row.recommendation_state === "PROCUREMENT_REVIEW").length,
      out_of_stock: a1.filter((row) => row.availability_state === "OUT_OF_STOCK").length,
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
    recommendations_without_human_review: rows.filter((row) => row.recommendation_state !== "NONE" && row.recommendation_requires_human_review !== true).length
  };
}

export function compareMultiAxisReadPaths(dbRows: CanonicalRow[], cloudRows: CanonicalRow[], sampleLimit = 20) {
  const db = new Map(dbRows.map((row) => [key(row), row]));
  const cloud = new Map(cloudRows.map((row) => [key(row), row]));
  const keys = new Set([...db.keys(), ...cloud.keys()]);
  const mismatchByField = Object.fromEntries(FIELDS.map((field) => [field, 0])) as Record<typeof FIELDS[number], number>;
  let missingInDb = 0;
  let missingInCloud = 0;
  let matchedKeys = 0;
  let rowsWithMismatch = 0;
  const samples: Array<Record<string, unknown>> = [];

  for (const k of keys) {
    const dbRow = db.get(k);
    const cloudRow = cloud.get(k);
    if (!dbRow) {
      missingInDb += 1;
      if (samples.length < sampleLimit) samples.push({ key: k, mismatch: "MISSING_IN_DB" });
      continue;
    }
    if (!cloudRow) {
      missingInCloud += 1;
      if (samples.length < sampleLimit) samples.push({ key: k, mismatch: "MISSING_IN_CLOUD" });
      continue;
    }
    matchedKeys += 1;
    const fieldDiffs: Record<string, unknown> = {};
    for (const field of FIELDS) {
      if (!equal(field, dbRow[field], cloudRow[field])) {
        mismatchByField[field] += 1;
        fieldDiffs[field] = { db: dbRow[field] ?? null, cloud: cloudRow[field] ?? null };
      }
    }
    if (Object.keys(fieldDiffs).length) {
      rowsWithMismatch += 1;
      if (samples.length < sampleLimit) samples.push({ key: k, fields: fieldDiffs });
    }
  }

  return {
    db_rows: dbRows.length,
    cloud_rows: cloudRows.length,
    matched_keys: matchedKeys,
    missing_in_db: missingInDb,
    missing_in_cloud: missingInCloud,
    rows_with_mismatch: rowsWithMismatch,
    mismatch_by_field: mismatchByField,
    exact_parity: missingInDb === 0 && missingInCloud === 0 && rowsWithMismatch === 0,
    sample_mismatches: samples
  };
}
