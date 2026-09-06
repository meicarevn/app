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
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validateHisPayload(body: JsonObject): {
  rows: unknown[];
  observedAt: string;
  sourceName: string | null;
  coverageType: "ORGANIZATION_FULL" | "WAREHOUSE_SET_FULL" | "PARTIAL";
  fileSha256: string | null;
  metadata: JsonObject;
} {
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > LIMITS.hisRows) {
    throw new HttpError(400, "INVALID_ROWS");
  }
  const observedAt = requireIsoTimestamp(body.observed_at, "INVALID_OBSERVED_AT");
  const sourceName = optionalString(body, "source_name", 512);
  const coverage = (body.coverage_type ?? "WAREHOUSE_SET_FULL") as unknown;
  if (!["ORGANIZATION_FULL", "WAREHOUSE_SET_FULL", "PARTIAL"].includes(String(coverage))) {
    throw new HttpError(400, "INVALID_COVERAGE_TYPE");
  }
  const fileSha256 = optionalString(body, "file_sha256", 64);
  if (fileSha256 && !/^[0-9a-fA-F]{64}$/.test(fileSha256)) throw new HttpError(400, "INVALID_FILE_SHA256");
  const metadata = body.metadata == null ? {} : body.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new HttpError(400, "INVALID_METADATA");
  return {
    rows,
    observedAt,
    sourceName,
    coverageType: String(coverage) as "ORGANIZATION_FULL" | "WAREHOUSE_SET_FULL" | "PARTIAL",
    fileSha256: fileSha256?.toLowerCase() ?? null,
    metadata: metadata as JsonObject
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
