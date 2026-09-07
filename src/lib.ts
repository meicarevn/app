export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly safeDetail?: string
  ) {
    super(code);
  }
}

export const LIMITS = {
  hisJsonBytes: 6 * 1024 * 1024,
  iotJsonBytes: 32 * 1024,
  userJsonBytes: 256 * 1024,
  r2ObjectBytes: 25 * 1024 * 1024,
  hisRows: 20_000,
  clockSkewSeconds: 300
} as const;

export const HIS_CONTRACT_VERSION = "MEICARE_HIS_INVENTORY_V1";
export const HIS_MAX_OBSERVATION_AGE_SECONDS = 24 * 60 * 60;

export type JsonObject = Record<string, unknown>;

export function requestId(req: Request): string {
  const supplied = req.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export async function readBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const length = req.headers.get("content-length");
  if (length) {
    const n = Number(length);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, "INVALID_CONTENT_LENGTH");
    if (n > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  return bytes;
}

export function parseJsonObject(bytes: Uint8Array): JsonObject {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "JSON_OBJECT_REQUIRED");
    }
    return parsed as JsonObject;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_JSON");
  }
}

export function requireString(body: JsonObject, key: string, maxLength = 256): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `INVALID_${key.toUpperCase()}`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new HttpError(400, `INVALID_${key.toUpperCase()}`);
  return trimmed;
}

export function optionalString(body: JsonObject, key: string, maxLength = 256): string | null {
  const value = body[key];
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `INVALID_${key.toUpperCase()}`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new HttpError(400, `INVALID_${key.toUpperCase()}`);
  return trimmed;
}

export function requireInteger(body: JsonObject, key: string, min = 0): number {
  const value = body[key];
  if (!Number.isInteger(value) || (value as number) < min) throw new HttpError(400, `INVALID_${key.toUpperCase()}`);
  return value as number;
}

export function optionalFiniteNumber(body: JsonObject, key: string, min: number, max: number): number | null {
  const value = body[key];
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `INVALID_${key.toUpperCase()}`);
  }
  return value;
}

export function requireIsoTimestamp(value: unknown, code = "INVALID_TIMESTAMP"): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, code);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new HttpError(400, code);
  return new Date(ms).toISOString();
}

export function validateFreshUnixSeconds(value: string | null, nowSeconds = Math.floor(Date.now() / 1000)): number {
  if (!value || !/^\d{10,13}$/.test(value)) throw new HttpError(401, "REQUEST_TIMESTAMP_REQUIRED");
  let ts = Number(value);
  if (value.length === 13) ts = Math.floor(ts / 1000);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > LIMITS.clockSkewSeconds) {
    throw new HttpError(401, "REQUEST_TIMESTAMP_OUTSIDE_WINDOW");
  }
  return ts;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const HIS_ENVELOPE_FIELDS = new Set([
  "contract_version", "batch_id", "source_sequence", "observed_at", "exported_at",
  "source_name", "coverage_type", "warehouse_codes", "partial_reason", "file_sha256",
  "row_count", "rows", "metadata"
]);

const HIS_ROW_FIELDS = new Set([
  "drug_external_code", "drug_name", "active_ingredient", "strength", "unit",
  "lot_number", "expiry_date", "warehouse_external_code", "warehouse_name",
  "zone_external_code", "zone_name", "quantity_on_hand", "unit_cost",
  "tender_number", "last_issue_at"
]);

const HIS_METADATA_FIELDS = new Set([
  "adapter_name", "adapter_version", "export_profile", "source_timezone",
  "source_file_format", "canary", "run_id"
]);

function rejectUnknownFields(value: JsonObject, allowed: Set<string>, code: string) {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new HttpError(400, code);
}

function hisText(value: unknown, code: string, maxLength: number, required = false): string | null {
  if (value == null || value === "") {
    if (required) throw new HttpError(400, code);
    return null;
  }
  if (typeof value !== "string") throw new HttpError(400, code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new HttpError(400, code);
  }
  return normalized;
}

function hisDate(value: unknown, code: string, required = false): string | null {
  const normalized = hisText(value, code, 10, required);
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new HttpError(400, code);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new HttpError(400, code);
  }
  return normalized;
}

function hisDecimal(value: unknown, code: string, integerDigits: number, decimalDigits: number, required = false): string | null {
  if (value == null || value === "") {
    if (required) throw new HttpError(400, code);
    return null;
  }
  const normalized = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const pattern = new RegExp(`^(?:0|[1-9]\\d{0,${integerDigits - 1}})(?:\\.\\d{1,${decimalDigits}})?$`);
  if (!pattern.test(normalized)) throw new HttpError(400, code);
  return normalized;
}

function hisMetadata(value: unknown): JsonObject {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_METADATA");
  const metadata = value as JsonObject;
  rejectUnknownFields(metadata, HIS_METADATA_FIELDS, "HIS_METADATA_FIELD_NOT_ALLOWED");
  for (const entry of Object.values(metadata)) {
    if (entry != null && !["string", "number", "boolean"].includes(typeof entry)) {
      throw new HttpError(400, "INVALID_METADATA_VALUE");
    }
    if (typeof entry === "string" && (entry.length > 256 || /[\u0000-\u001f\u007f]/.test(entry))) {
      throw new HttpError(400, "INVALID_METADATA_VALUE");
    }
  }
  return metadata;
}

export function validateHisPayload(body: JsonObject, nowMs = Date.now()): {
  contractVersion: typeof HIS_CONTRACT_VERSION;
  batchId: string;
  sourceSequence: number;
  rows: JsonObject[];
  observedAt: string;
  exportedAt: string;
  sourceName: string;
  coverageType: "ORGANIZATION_FULL" | "WAREHOUSE_SET_FULL" | "PARTIAL";
  warehouseCodes: string[];
  partialReason: string | null;
  fileSha256: string;
  metadata: JsonObject;
  statistics: {
    sourceRows: number;
    uniqueLotPositions: number;
    duplicateLotPositionRows: number;
  };
} {
  rejectUnknownFields(body, HIS_ENVELOPE_FIELDS, "HIS_ENVELOPE_FIELD_NOT_ALLOWED");
  if (body.contract_version !== HIS_CONTRACT_VERSION) throw new HttpError(400, "HIS_CONTRACT_VERSION_UNSUPPORTED");

  const batchId = requireString(body, "batch_id", 128);
  if (batchId.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(batchId)) throw new HttpError(400, "INVALID_BATCH_ID");

  const sourceSequence = requireInteger(body, "source_sequence", 0);
  if (!Number.isSafeInteger(sourceSequence)) throw new HttpError(400, "INVALID_SOURCE_SEQUENCE");

  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > LIMITS.hisRows) {
    throw new HttpError(400, "INVALID_ROWS");
  }
  const declaredRowCount = requireInteger(body, "row_count", 1);
  if (declaredRowCount !== rows.length) throw new HttpError(400, "HIS_ROW_COUNT_MISMATCH");

  const observedAt = requireIsoTimestamp(body.observed_at, "INVALID_OBSERVED_AT");
  const exportedAt = requireIsoTimestamp(body.exported_at, "INVALID_EXPORTED_AT");
  const observedMs = Date.parse(observedAt);
  const exportedMs = Date.parse(exportedAt);
  if (observedMs > nowMs + LIMITS.clockSkewSeconds * 1000 || exportedMs > nowMs + LIMITS.clockSkewSeconds * 1000) {
    throw new HttpError(400, "HIS_TIMESTAMP_IN_FUTURE");
  }
  if (exportedMs < observedMs) throw new HttpError(400, "HIS_EXPORT_BEFORE_OBSERVATION");
  if (nowMs - observedMs > HIS_MAX_OBSERVATION_AGE_SECONDS * 1000) {
    throw new HttpError(409, "HIS_OBSERVATION_STALE");
  }

  const sourceName = requireString(body, "source_name", 512);
  const coverage = body.coverage_type as unknown;
  if (!["ORGANIZATION_FULL", "WAREHOUSE_SET_FULL", "PARTIAL"].includes(String(coverage))) {
    throw new HttpError(400, "INVALID_COVERAGE_TYPE");
  }

  if (!Array.isArray(body.warehouse_codes) || body.warehouse_codes.length === 0 || body.warehouse_codes.length > 500) {
    throw new HttpError(400, "INVALID_WAREHOUSE_CODES");
  }
  const warehouseCodes = [...new Set(body.warehouse_codes.map((value) => (
    hisText(value, "INVALID_WAREHOUSE_CODE", 64, true) as string
  ).toUpperCase()))];
  if (warehouseCodes.length !== body.warehouse_codes.length) throw new HttpError(400, "DUPLICATE_WAREHOUSE_CODE");
  const declaredWarehouses = new Set(warehouseCodes);

  const partialReason = hisText(body.partial_reason, "INVALID_PARTIAL_REASON", 500);
  if (coverage === "PARTIAL" && partialReason == null) throw new HttpError(400, "PARTIAL_REASON_REQUIRED");
  if (coverage !== "PARTIAL" && partialReason != null) throw new HttpError(400, "PARTIAL_REASON_NOT_ALLOWED");

  const fileSha256 = requireString(body, "file_sha256", 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(fileSha256)) throw new HttpError(400, "INVALID_FILE_SHA256");
  const metadata = hisMetadata(body.metadata);

  const observedWarehouses = new Set<string>();
  const lotPositions = new Set<string>();
  const expiryByLot = new Map<string, string>();
  const normalizedRows = rows.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_HIS_ROW");
    const row = value as JsonObject;
    rejectUnknownFields(row, HIS_ROW_FIELDS, "HIS_ROW_FIELD_NOT_ALLOWED");

    const drugExternalCode = (hisText(row.drug_external_code, "INVALID_DRUG_EXTERNAL_CODE", 128, true) as string).toUpperCase();
    const warehouseExternalCode = (hisText(row.warehouse_external_code, "INVALID_WAREHOUSE_EXTERNAL_CODE", 64, true) as string).toUpperCase();
    const lotNumber = (hisText(row.lot_number, "INVALID_LOT_NUMBER", 128, true) as string).toUpperCase();
    const zoneExternalCode = hisText(row.zone_external_code, "INVALID_ZONE_EXTERNAL_CODE", 64)?.toUpperCase() ?? null;
    const expiryDate = hisDate(row.expiry_date, "INVALID_EXPIRY_DATE", true) as string;
    const quantityOnHand = hisDecimal(row.quantity_on_hand, "INVALID_QUANTITY_ON_HAND", 12, 6, true) as string;
    const unitCost = hisDecimal(row.unit_cost, "INVALID_UNIT_COST", 15, 4);

    if (!declaredWarehouses.has(warehouseExternalCode)) throw new HttpError(400, "ROW_WAREHOUSE_NOT_DECLARED");
    observedWarehouses.add(warehouseExternalCode);
    const lotIdentity = `${drugExternalCode}|${lotNumber}`;
    const priorExpiry = expiryByLot.get(lotIdentity);
    if (priorExpiry && priorExpiry !== expiryDate) throw new HttpError(409, "HIS_EXPIRY_CONFLICT_IN_BATCH");
    expiryByLot.set(lotIdentity, expiryDate);
    lotPositions.add(`${warehouseExternalCode}|${zoneExternalCode || "DEFAULT"}|${lotIdentity}|${expiryDate}`);

    const normalized: JsonObject = {
      drug_external_code: drugExternalCode,
      drug_name: hisText(row.drug_name, "INVALID_DRUG_NAME", 512),
      active_ingredient: hisText(row.active_ingredient, "INVALID_ACTIVE_INGREDIENT", 512),
      strength: hisText(row.strength, "INVALID_STRENGTH", 128),
      unit: hisText(row.unit, "INVALID_UNIT", 64),
      lot_number: lotNumber,
      expiry_date: expiryDate,
      warehouse_external_code: warehouseExternalCode,
      warehouse_name: hisText(row.warehouse_name, "INVALID_WAREHOUSE_NAME", 256),
      zone_external_code: zoneExternalCode,
      zone_name: hisText(row.zone_name, "INVALID_ZONE_NAME", 256),
      quantity_on_hand: quantityOnHand,
      unit_cost: unitCost,
      tender_number: hisText(row.tender_number, "INVALID_TENDER_NUMBER", 128),
      last_issue_at: hisDate(row.last_issue_at, "INVALID_LAST_ISSUE_AT")
    };
    normalized.raw = Object.fromEntries(Object.entries(normalized).filter(([, field]) => field != null));
    return normalized;
  });

  if (warehouseCodes.some((code) => !observedWarehouses.has(code))) {
    throw new HttpError(400, "DECLARED_WAREHOUSE_WITHOUT_ROWS");
  }

  return {
    contractVersion: HIS_CONTRACT_VERSION,
    batchId,
    sourceSequence,
    rows: normalizedRows,
    observedAt,
    exportedAt,
    sourceName,
    coverageType: String(coverage) as "ORGANIZATION_FULL" | "WAREHOUSE_SET_FULL" | "PARTIAL",
    warehouseCodes,
    partialReason,
    fileSha256,
    metadata,
    statistics: {
      sourceRows: rows.length,
      uniqueLotPositions: lotPositions.size,
      duplicateLotPositionRows: rows.length - lotPositions.size
    }
  };
}

export function validateIotPayload(body: JsonObject, deviceUidFromHeader?: string | null) {
  const bodyDeviceUid = optionalString(body, "device_uid", 128);
  const headerDeviceUid = deviceUidFromHeader?.trim() || null;
  if (headerDeviceUid && headerDeviceUid.length > 128) throw new HttpError(400, "INVALID_DEVICE_UID");
  if (bodyDeviceUid && headerDeviceUid && bodyDeviceUid !== headerDeviceUid) throw new HttpError(401, "DEVICE_UID_MISMATCH");
  const deviceUid = headerDeviceUid || bodyDeviceUid;
  if (!deviceUid) throw new HttpError(400, "INVALID_DEVICE_UID");

  const sequenceNumber = requireInteger(body, "sequence_number", 0);
  const recordedAt = requireIsoTimestamp(body.recorded_at, "INVALID_RECORDED_AT");
  const temperature = optionalFiniteNumber(body, "temperature", -50, 80);
  const humidity = optionalFiniteNumber(body, "humidity", 0, 100);
  if (temperature == null || humidity == null) throw new HttpError(400, "TEMPERATURE_AND_HUMIDITY_REQUIRED");
  const batteryVoltage = optionalFiniteNumber(body, "battery_voltage", 0, 30);
  const signalStrength = optionalFiniteNumber(body, "signal_strength", -200, 0);
  const powerStatus = optionalString(body, "power_status", 64);
  const sensorStatus = optionalString(body, "sensor_status", 64);
  const readingKind = String(body.reading_kind ?? "CHANGE").toUpperCase();
  if (!["CHANGE", "HEARTBEAT", "ALERT", "MANUAL_TEST"].includes(readingKind)) throw new HttpError(400, "INVALID_READING_KIND");
  const sourceEventKey = optionalString(body, "source_event_key", 256);
  const metadata = body.metadata == null ? {} : body.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new HttpError(400, "INVALID_METADATA");
  return {
    deviceUid,
    sequenceNumber,
    recordedAt,
    temperature,
    humidity,
    batteryVoltage,
    signalStrength: signalStrength == null ? null : Math.trunc(signalStrength),
    powerStatus,
    sensorStatus,
    readingKind,
    sourceEventKey,
    metadata: metadata as JsonObject
  };
}

export function validIdempotencyKey(value: string | null): string {
  const key = value?.trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
}
