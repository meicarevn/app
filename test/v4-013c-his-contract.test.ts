import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIS_CONTRACT_VERSION, HttpError, validateHisPayload } from "../src/lib";

const now = Date.parse("2026-09-07T04:00:00.000Z");
const gateway = readFileSync("src/index.ts", "utf8");

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: HIS_CONTRACT_VERSION,
    batch_id: "vnpt-20260907-0001",
    source_sequence: 202609070001,
    observed_at: "2026-09-07T10:00:00+07:00",
    exported_at: "2026-09-07T10:05:00+07:00",
    source_name: "ton-kho-vnpt-20260907.xlsx",
    coverage_type: "WAREHOUSE_SET_FULL",
    warehouse_codes: ["kho-01"],
    file_sha256: "a".repeat(64),
    row_count: 2,
    rows: [
      {
        drug_external_code: " 18892 ",
        drug_name: "Thuốc A",
        warehouse_external_code: "kho-01",
        lot_number: " 1330526 ",
        expiry_date: "2029-06-01",
        quantity_on_hand: "100.5",
        unit_cost: "2500"
      },
      {
        drug_external_code: "18892",
        warehouse_external_code: "KHO-01",
        lot_number: "1330526",
        expiry_date: "2029-06-01",
        quantity_on_hand: "50"
      }
    ],
    metadata: {
      adapter_name: "vnpt-his-export",
      adapter_version: "1.0.0",
      export_profile: "INVENTORY_BY_LOT",
      source_timezone: "Asia/Ho_Chi_Minh",
      source_file_format: "XLSX"
    },
    ...overrides
  };
}

function codeFor(fn: () => unknown) {
  try {
    fn();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof HttpError ? error.code : String(error);
  }
}

describe("V4_013C VNPT-HIS commercial contract", () => {
  it("normalizes safe inventory rows and records duplicate lot-position evidence", () => {
    const result = validateHisPayload(envelope(), now);
    expect(result.contractVersion).toBe(HIS_CONTRACT_VERSION);
    expect(result.rows[0]).toMatchObject({
      drug_external_code: "18892",
      warehouse_external_code: "KHO-01",
      lot_number: "1330526",
      quantity_on_hand: "100.5"
    });
    expect(result.statistics).toEqual({ sourceRows: 2, uniqueLotPositions: 1, duplicateLotPositionRows: 1 });
  });

  it("rejects stale observations before staging", () => {
    expect(codeFor(() => validateHisPayload(envelope({
      observed_at: "2026-09-05T10:00:00+07:00",
      exported_at: "2026-09-05T10:05:00+07:00"
    }), now))).toBe("HIS_OBSERVATION_STALE");
  });

  it("rejects patient or other non-contract fields", () => {
    const rows = [...(envelope().rows as Array<Record<string, unknown>>)];
    rows[0] = { ...rows[0], patient_name: "must-not-enter-platform" };
    expect(codeFor(() => validateHisPayload(envelope({ rows }), now))).toBe("HIS_ROW_FIELD_NOT_ALLOWED");
  });

  it("requires declared coverage to match the batch", () => {
    expect(codeFor(() => validateHisPayload(envelope({ warehouse_codes: ["KHO-02"] }), now))).toBe("ROW_WAREHOUSE_NOT_DECLARED");
    expect(codeFor(() => validateHisPayload(envelope({ row_count: 1 }), now))).toBe("HIS_ROW_COUNT_MISMATCH");
  });

  it("rejects conflicting expiry identity inside one batch", () => {
    const rows = [...(envelope().rows as Array<Record<string, unknown>>)];
    rows[1] = { ...rows[1], expiry_date: "2029-07-01" };
    expect(codeFor(() => validateHisPayload(envelope({ rows }), now))).toBe("HIS_EXPIRY_CONFLICT_IN_BATCH");
  });

  it("requires an explicit reason for a partial extract", () => {
    expect(codeFor(() => validateHisPayload(envelope({ coverage_type: "PARTIAL" }), now))).toBe("PARTIAL_REASON_REQUIRED");
  });

  it("persists content-addressed evidence before database staging", () => {
    expect(gateway).toContain('throw new HttpError(503, "HIS_EVIDENCE_STORE_NOT_CONFIGURED")');
    expect(gateway).toContain('throw new HttpError(503, "HIS_EVIDENCE_WRITE_FAILED")');
    expect(gateway).toContain('onlyIf: { etagDoesNotMatch: "*" }');
    expect(gateway).toContain('throw new HttpError(409, "HIS_EVIDENCE_CONFLICT")');
    expect(gateway).toContain("if (error instanceof HttpError) throw error");
    expect(gateway).toContain("source_artifact_sha256: validated.fileSha256");
    expect(gateway.indexOf("EVIDENCE_BUCKET.put(evidenceObjectKey")).toBeLessThan(
      gateway.indexOf('rpc(env, "stage_inventory_observation_v4"')
    );
  });

  it("binds JSON transport and the batch identity before HIS authentication", () => {
    expect(gateway).toContain('throw new HttpError(415, "CONTENT_TYPE_JSON_REQUIRED")');
    expect(gateway).toContain('throw new HttpError(400, "HIS_BATCH_IDEMPOTENCY_MISMATCH")');
    expect(gateway.indexOf("HIS_BATCH_IDEMPOTENCY_MISMATCH")).toBeLessThan(
      gateway.indexOf('rpc(env, "authenticate_his_connection_v2"')
    );
  });
});
