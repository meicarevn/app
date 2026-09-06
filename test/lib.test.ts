import { describe, expect, it } from "vitest";
import {
  HttpError,
  parseJsonObject,
  sha256Hex,
  validIdempotencyKey,
  validateFreshUnixSeconds,
  validateHisPayload,
  validateIotPayload
} from "../src/lib";

const enc = new TextEncoder();

describe("gateway validation", () => {
  it("computes a deterministic SHA-256 digest", async () => {
    expect(await sha256Hex(enc.encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("accepts a timestamp inside the freshness window", () => {
    expect(validateFreshUnixSeconds("1760000000", 1760000100)).toBe(1760000000);
  });

  it("rejects stale timestamps", () => {
    expect(() => validateFreshUnixSeconds("1760000000", 1760001000)).toThrowError(HttpError);
  });

  it("requires a stable idempotency key", () => {
    expect(validIdempotencyKey("batch-20260906-001")).toBe("batch-20260906-001");
    expect(() => validIdempotencyKey("short")).toThrowError(HttpError);
  });

  it("validates HIS observation envelopes without changing row content", () => {
    const payload = validateHisPayload({
      rows: [{ drug_external_code: "18705", lot_number: "250490", expiry_date: "2028-12-02", quantity_on_hand: "10" }],
      observed_at: "2026-09-06T08:00:00+07:00",
      coverage_type: "WAREHOUSE_SET_FULL",
      metadata: { source: "test" }
    });
    expect(payload.rows).toHaveLength(1);
    expect(payload.coverageType).toBe("WAREHOUSE_SET_FULL");
    expect(payload.observedAt).toBe("2026-09-06T01:00:00.000Z");
  });

  it("rejects invalid HIS coverage", () => {
    expect(() => validateHisPayload({
      rows: [{}],
      observed_at: "2026-09-06T08:00:00+07:00",
      coverage_type: "EVERYTHING"
    })).toThrowError(HttpError);
  });

  it("accepts the existing ESP device identity from X-Device-Id", () => {
    const reading = validateIotPayload({
      sequence_number: 42,
      recorded_at: "2026-09-06T08:00:00+07:00",
      temperature: 25.5,
      humidity: 64,
      reading_kind: "heartbeat"
    }, "ESP01S-001");
    expect(reading.deviceUid).toBe("ESP01S-001");
    expect(reading.sequenceNumber).toBe(42);
    expect(reading.readingKind).toBe("HEARTBEAT");
  });

  it("accepts device_uid in the body for forward compatibility", () => {
    const reading = validateIotPayload({
      device_uid: "ESP01S-001",
      sequence_number: 43,
      recorded_at: "2026-09-06T08:00:00+07:00",
      temperature: 25,
      humidity: 60
    });
    expect(reading.deviceUid).toBe("ESP01S-001");
  });

  it("rejects a body/header device identity mismatch", () => {
    expect(() => validateIotPayload({
      device_uid: "ESP01S-002",
      sequence_number: 44,
      recorded_at: "2026-09-06T08:00:00+07:00",
      temperature: 25,
      humidity: 60
    }, "ESP01S-001")).toThrowError(HttpError);
  });

  it("rejects impossible humidity before it reaches the IoT engine", () => {
    expect(() => validateIotPayload({
      sequence_number: 45,
      recorded_at: "2026-09-06T08:00:00+07:00",
      temperature: 25,
      humidity: 101
    }, "ESP01S-001")).toThrowError(HttpError);
  });

  it("rejects non-object JSON payloads", () => {
    expect(() => parseJsonObject(enc.encode("[]"))).toThrowError(HttpError);
  });
});
