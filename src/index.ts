import {
  HttpError,
  LIMITS,
  JsonObject,
  optionalString,
  parseJsonObject,
  readBody,
  requestId,
  requireString,
  sha256Hex,
  validIdempotencyKey,
  validateFreshUnixSeconds,
  validateHisPayload,
  validateIotPayload
} from "./lib";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  R2_BUCKET_NAME: string;
  IOT_AUTH_URL?: string;
  IOT_AUTH_TOKEN?: string;
  EVIDENCE_BUCKET: R2Bucket;
  REQUEST_GUARD: DurableObjectNamespace;
}

type Json = JsonObject | unknown[] | string | number | boolean | null;

type GuardEntry = {
  hash: string;
  state: "IN_PROGRESS" | "COMPLETE";
  createdAt: number;
  updatedAt: number;
  result?: Json;
};

type GuardClaim = { status: "CLAIMED" | "CACHED"; result?: Json };

const json = (body: Json, status: number, rid: string) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-request-id": rid,
    "x-content-type-options": "nosniff"
  }
});

function bearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

async function rpc(env: Env, fn: string, body: JsonObject, rid: string, userBearer?: string) {
  const key = userBearer || env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: userBearer ? env.SUPABASE_ANON_KEY : env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "x-request-id": rid
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    console.error(JSON.stringify({ event: "supabase_rpc_failed", fn, status: res.status, request_id: rid }));
    throw new HttpError(res.status === 401 || res.status === 403 ? res.status : 502, "UPSTREAM_RPC_FAILED");
  }
  return parsed;
}

async function verifyUser(env: Env, token: string, rid: string): Promise<{ id: string }> {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, "x-request-id": rid }
  });
  if (!res.ok) throw new HttpError(401, "UNAUTHORIZED");
  const user = await res.json() as { id?: unknown };
  if (typeof user.id !== "string") throw new HttpError(401, "UNAUTHORIZED");
  return { id: user.id };
}

async function documentVersionForUser(env: Env, token: string, versionId: string, rid: string) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/document_versions_v4`);
  url.searchParams.set("id", `eq.${versionId}`);
  url.searchParams.set("select", "id,storage_provider,storage_bucket,object_key,status");
  const res = await fetch(url.toString(), {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, "x-request-id": rid }
  });
  if (!res.ok) throw new HttpError(res.status === 401 || res.status === 403 ? res.status : 502, "DOCUMENT_LOOKUP_FAILED");
  const rows = await res.json() as Array<Record<string, unknown>>;
  if (rows.length !== 1) throw new HttpError(404, "DOCUMENT_VERSION_NOT_FOUND");
  return rows[0];
}

async function guardClaim(env: Env, scope: string, key: string, hash: string, maxPerMinute: number): Promise<GuardClaim> {
  const id = env.REQUEST_GUARD.idFromName(scope);
  const stub = env.REQUEST_GUARD.get(id);
  const res = await stub.fetch("https://request-guard/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, hash, max_per_minute: maxPerMinute })
  });
  const payload = await res.json() as Record<string, unknown>;
  if (res.status === 429) throw new HttpError(429, "RATE_LIMITED");
  if (!res.ok) throw new HttpError(409, String(payload.error || "IDEMPOTENCY_CONFLICT"));
  return payload as GuardClaim;
}

async function guardComplete(env: Env, scope: string, key: string, hash: string, result: Json) {
  const id = env.REQUEST_GUARD.idFromName(scope);
  await env.REQUEST_GUARD.get(id).fetch("https://request-guard/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, hash, result })
  });
}

async function guardRelease(env: Env, scope: string, key: string, hash: string) {
  const id = env.REQUEST_GUARD.idFromName(scope);
  await env.REQUEST_GUARD.get(id).fetch("https://request-guard/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, hash })
  });
}

async function verifyIotSignature(
  env: Env,
  rid: string,
  deviceUid: string,
  timestamp: number,
  bodyHash: string,
  signature: string,
  sequenceNumber: number
): Promise<Record<string, unknown>> {
  if (!env.IOT_AUTH_URL || !env.IOT_AUTH_TOKEN) throw new HttpError(503, "IOT_AUTH_ADAPTER_NOT_CONFIGURED");
  if (!/^[A-Za-z0-9+/=_-]{32,512}$/.test(signature)) throw new HttpError(401, "INVALID_IOT_SIGNATURE");
  const res = await fetch(env.IOT_AUTH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.IOT_AUTH_TOKEN}`,
      "content-type": "application/json",
      "x-request-id": rid
    },
    body: JSON.stringify({
      signature_version: "v1",
      device_uid: deviceUid,
      timestamp,
      body_sha256: bodyHash,
      signature,
      sequence_number: sequenceNumber
    })
  });
  if (!res.ok) throw new HttpError(res.status === 429 ? 429 : 401, res.status === 429 ? "IOT_AUTH_RATE_LIMITED" : "IOT_AUTH_FAILED");
  const result = await res.json() as Record<string, unknown>;
  if (result.authenticated !== true) throw new HttpError(401, "IOT_AUTH_FAILED");
  return result;
}

async function handleHisInventory(req: Request, env: Env, rid: string) {
  const connectionId = req.headers.get("x-meicare-connection-id")?.trim();
  const apiKey = req.headers.get("x-meicare-api-key")?.trim();
  if (!connectionId || !apiKey) throw new HttpError(401, "HIS_CREDENTIALS_REQUIRED");
  validateFreshUnixSeconds(req.headers.get("x-meicare-timestamp"));
  const idempotencyKey = validIdempotencyKey(req.headers.get("x-idempotency-key"));
  const bytes = await readBody(req, LIMITS.hisJsonBytes);
  const bodyHash = await sha256Hex(bytes);
  const body = parseJsonObject(bytes);
  const validated = validateHisPayload(body);

  const auth = await rpc(env, "authenticate_his_connection_v2", {
    p_connection_id: connectionId,
    p_api_key: apiKey
  }, rid) as Record<string, unknown>;
  if (typeof auth.organization_id !== "string" || typeof auth.source_system !== "string") throw new HttpError(502, "INVALID_HIS_AUTH_RESPONSE");

  const scope = `his:${connectionId}`;
  const claim = await guardClaim(env, scope, idempotencyKey, bodyHash, 12);
  if (claim.status === "CACHED") return json(claim.result ?? { status: "STAGED" }, 202, rid);

  try {
    const staged = await rpc(env, "stage_inventory_observation_v4", {
      p_organization_id: auth.organization_id,
      p_source_system: auth.source_system,
      p_rows: validated.rows,
      p_observed_at: validated.observedAt,
      p_source_name: validated.sourceName || "cloudflare-gateway",
      p_coverage_type: validated.coverageType,
      p_file_sha256: validated.fileSha256,
      p_metadata: {
        ...validated.metadata,
        gateway_request_id: rid,
        gateway_idempotency_key: idempotencyKey,
        gateway_payload_sha256: bodyHash
      }
    }, rid) as Record<string, unknown>;
    const importJobId = staged.import_job_id;
    const reconciliationId = typeof importJobId === "string"
      ? await rpc(env, "prepare_inventory_reconciliation_v4", { p_import_job_id: importJobId }, rid)
      : null;
    const result: JsonObject = { status: "STAGED", staged, reconciliation_id: reconciliationId };
    await guardComplete(env, scope, idempotencyKey, bodyHash, result);
    return json(result, 202, rid);
  } catch (error) {
    await guardRelease(env, scope, idempotencyKey, bodyHash);
    throw error;
  }
}

async function handleIot(req: Request, env: Env, rid: string) {
  const timestamp = validateFreshUnixSeconds(req.headers.get("x-meicare-timestamp"));
  const signature = req.headers.get("x-meicare-signature")?.trim();
  if (!signature) throw new HttpError(401, "IOT_SIGNATURE_REQUIRED");
  const bytes = await readBody(req, LIMITS.iotJsonBytes);
  const bodyHash = await sha256Hex(bytes);
  const body = parseJsonObject(bytes);
  const reading = validateIotPayload(body);

  const auth = await verifyIotSignature(env, rid, reading.deviceUid, timestamp, bodyHash, signature, reading.sequenceNumber);
  const scope = `iot:${reading.deviceUid}`;
  const key = `seq:${reading.sequenceNumber}`;
  const claim = await guardClaim(env, scope, key, bodyHash, 120);
  if (claim.status === "CACHED") return json(claim.result ?? { status: "duplicate" }, 202, rid);

  try {
    const result = await rpc(env, "ingest_iot_reading_v4", {
      p_device_uid: reading.deviceUid,
      p_recorded_at: reading.recordedAt,
      p_sequence_number: reading.sequenceNumber,
      p_temperature: reading.temperature,
      p_humidity: reading.humidity,
      p_battery_voltage: reading.batteryVoltage,
      p_signal_strength: reading.signalStrength,
      p_power_status: reading.powerStatus,
      p_sensor_status: reading.sensorStatus,
      p_reading_kind: reading.readingKind,
      p_source_event_key: reading.sourceEventKey || `IOT:${reading.deviceUid}:${reading.sequenceNumber}`,
      p_metadata: {
        ...reading.metadata,
        gateway_request_id: rid,
        gateway_payload_sha256: bodyHash,
        auth_key_version: auth.key_version ?? null,
        auth_signature_version: "v1"
      }
    }, rid) as Json;
    await guardComplete(env, scope, key, bodyHash, result);
    return json(result, 202, rid);
  } catch (error) {
    await guardRelease(env, scope, key, bodyHash);
    throw error;
  }
}

async function handleR2Reserve(req: Request, env: Env, rid: string) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "UNAUTHORIZED");
  const user = await verifyUser(env, token, rid);
  const idempotencyKey = validIdempotencyKey(req.headers.get("x-idempotency-key"));
  const bytes = await readBody(req, LIMITS.userJsonBytes);
  const hash = await sha256Hex(bytes);
  const body = parseJsonObject(bytes);
  const documentId = requireString(body, "document_id", 64);
  const fileName = requireString(body, "file_name", 512);
  const mimeType = optionalString(body, "mime_type", 255);
  const metadata = body.metadata == null ? {} : body.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new HttpError(400, "INVALID_METADATA");
  const scope = `user:${user.id}:document-reserve`;
  const claim = await guardClaim(env, scope, idempotencyKey, hash, 60);
  if (claim.status === "CACHED") return json(claim.result ?? {}, 201, rid);
  try {
    const reservation = await rpc(env, "reserve_document_version_v4", {
      p_document_id: documentId,
      p_file_name: fileName,
      p_mime_type: mimeType,
      p_storage_bucket: env.R2_BUCKET_NAME,
      p_source_metadata: { ...(metadata as JsonObject), gateway_request_id: rid, gateway_payload_sha256: hash }
    }, rid, token) as Json;
    await guardComplete(env, scope, idempotencyKey, hash, reservation);
    return json(reservation, 201, rid);
  } catch (error) {
    await guardRelease(env, scope, idempotencyKey, hash);
    throw error;
  }
}

async function handleR2Put(req: Request, env: Env, objectKey: string, rid: string) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "UNAUTHORIZED");
  const user = await verifyUser(env, token, rid);
  if (!objectKey) throw new HttpError(400, "OBJECT_KEY_REQUIRED");
  const versionId = req.headers.get("x-document-version-id")?.trim();
  if (!versionId) throw new HttpError(400, "DOCUMENT_VERSION_REQUIRED");

  const version = await documentVersionForUser(env, token, versionId, rid);
  if (version.storage_provider !== "R2" || version.storage_bucket !== env.R2_BUCKET_NAME) throw new HttpError(409, "DOCUMENT_STORAGE_MISMATCH");
  if (version.object_key !== objectKey) throw new HttpError(409, "DOCUMENT_OBJECT_KEY_MISMATCH");
  if (version.status !== "PENDING_UPLOAD") throw new HttpError(409, "DOCUMENT_VERSION_NOT_PENDING_UPLOAD");

  const bytes = await readBody(req, LIMITS.r2ObjectBytes);
  const computedChecksum = await sha256Hex(bytes);
  const clientChecksum = req.headers.get("x-content-sha256")?.trim().toLowerCase();
  if (clientChecksum && clientChecksum !== computedChecksum) throw new HttpError(422, "CONTENT_SHA256_MISMATCH");

  const scope = `user:${user.id}:document-upload`;
  const key = `version:${versionId}`;
  const claim = await guardClaim(env, scope, key, computedChecksum, 30);
  if (claim.status === "CACHED") return json(claim.result ?? {}, 200, rid);
  try {
    await env.EVIDENCE_BUCKET.put(objectKey, bytes, {
      httpMetadata: { contentType: req.headers.get("content-type") || "application/octet-stream" },
      customMetadata: { version_id: versionId, sha256: computedChecksum, gateway_request_id: rid }
    });
    await rpc(env, "finalize_document_version_v4", {
      p_version_id: versionId,
      p_file_size_bytes: bytes.byteLength,
      p_checksum_sha256: computedChecksum
    }, rid, token);
    const result: JsonObject = {
      status: "AVAILABLE",
      version_id: versionId,
      object_key: objectKey,
      size: bytes.byteLength,
      sha256: computedChecksum
    };
    await guardComplete(env, scope, key, computedChecksum, result);
    return json(result, 200, rid);
  } catch (error) {
    await guardRelease(env, scope, key, computedChecksum);
    throw error;
  }
}

async function handleAiRun(req: Request, env: Env, rid: string) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "UNAUTHORIZED");
  const user = await verifyUser(env, token, rid);
  const idempotencyKey = validIdempotencyKey(req.headers.get("x-idempotency-key"));
  const bytes = await readBody(req, LIMITS.userJsonBytes);
  const hash = await sha256Hex(bytes);
  const body = parseJsonObject(bytes);
  const organizationId = requireString(body, "organization_id", 64);
  const runType = requireString(body, "run_type", 128);
  const scope = `user:${user.id}:ai-run`;
  const claim = await guardClaim(env, scope, idempotencyKey, hash, 30);
  if (claim.status === "CACHED") return json(claim.result ?? {}, 201, rid);
  try {
    const id = await rpc(env, "create_ai_run_v4", {
      p_organization_id: organizationId,
      p_run_type: runType,
      p_model_provider: optionalString(body, "model_provider", 128),
      p_model_name: optionalString(body, "model_name", 128),
      p_model_version: optionalString(body, "model_version", 128),
      p_prompt_template_version: optionalString(body, "prompt_template_version", 128),
      p_tool_policy_version: optionalString(body, "tool_policy_version", 128),
      p_input_classification: String(body.input_classification || "L1_INTERNAL"),
      p_input_hash: optionalString(body, "input_hash", 128),
      p_input_summary: (body.input_summary && typeof body.input_summary === "object" && !Array.isArray(body.input_summary)) ? body.input_summary : {},
      p_data_minimization_note: optionalString(body, "data_minimization_note", 2000),
      p_correlation_id: optionalString(body, "correlation_id", 64) || crypto.randomUUID(),
      p_initiated_by: null
    }, rid, token);
    const result: JsonObject = { ai_run_id: id };
    await guardComplete(env, scope, idempotencyKey, hash, result);
    return json(result, 201, rid);
  } catch (error) {
    await guardRelease(env, scope, idempotencyKey, hash);
    throw error;
  }
}

export class RequestGuard {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const body = await req.json() as Record<string, unknown>;
    const key = typeof body.key === "string" ? body.key : "";
    const hash = typeof body.hash === "string" ? body.hash : "";
    if (!key || !hash) return new Response(JSON.stringify({ error: "INVALID_GUARD_REQUEST" }), { status: 400 });
    const storageKey = `req:${key}`;
    const now = Date.now();

    if (url.pathname === "/claim") {
      const maxPerMinute = Math.max(1, Math.min(10_000, Number(body.max_per_minute || 60)));
      const result = await this.state.storage.transaction(async (txn) => {
        const rate = await txn.get<{ minute: number; count: number }>("rate");
        const minute = Math.floor(now / 60_000);
        const nextRate = rate?.minute === minute ? { minute, count: rate.count + 1 } : { minute, count: 1 };
        if (nextRate.count > maxPerMinute) return { http: 429, payload: { error: "RATE_LIMITED" } };
        await txn.put("rate", nextRate);

        const existing = await txn.get<GuardEntry>(storageKey);
        if (existing) {
          if (existing.hash !== hash) return { http: 409, payload: { error: "IDEMPOTENCY_CONFLICT" } };
          if (existing.state === "COMPLETE") return { http: 200, payload: { status: "CACHED", result: existing.result ?? null } };
          if (now - existing.updatedAt < 60_000) return { http: 409, payload: { error: "REQUEST_IN_PROGRESS" } };
        }
        const entry: GuardEntry = { hash, state: "IN_PROGRESS", createdAt: existing?.createdAt ?? now, updatedAt: now };
        await txn.put(storageKey, entry);
        return { http: 200, payload: { status: "CLAIMED" } };
      });
      if (await this.state.storage.getAlarm() == null) await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
      return new Response(JSON.stringify(result.payload), { status: result.http, headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/complete") {
      const existing = await this.state.storage.get<GuardEntry>(storageKey);
      if (!existing || existing.hash !== hash) return new Response(JSON.stringify({ error: "GUARD_ENTRY_NOT_FOUND" }), { status: 409 });
      const entry: GuardEntry = { ...existing, state: "COMPLETE", updatedAt: now, result: (body.result ?? null) as Json };
      await this.state.storage.put(storageKey, entry);
      return new Response(JSON.stringify({ status: "COMPLETE" }), { status: 200 });
    }

    if (url.pathname === "/release") {
      const existing = await this.state.storage.get<GuardEntry>(storageKey);
      if (existing?.hash === hash && existing.state === "IN_PROGRESS") await this.state.storage.delete(storageKey);
      return new Response(JSON.stringify({ status: "RELEASED" }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404 });
  }

  async alarm() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const entries = await this.state.storage.list<GuardEntry>({ prefix: "req:" });
    const expired: string[] = [];
    for (const [key, value] of entries) if (value.updatedAt < cutoff) expired.push(key);
    if (expired.length) await this.state.storage.delete(expired);
    if ((await this.state.storage.list({ prefix: "req:", limit: 1 })).size > 0) {
      await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const rid = requestId(req);
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json({
          status: "ok",
          service: "meicare-v4-gateway",
          mode: "shadow",
          iot_auth_configured: Boolean(env.IOT_AUTH_URL && env.IOT_AUTH_TOKEN),
          request_guard_configured: Boolean(env.REQUEST_GUARD),
          r2_configured: Boolean(env.EVIDENCE_BUCKET)
        }, 200, rid);
      }
      if (req.method === "POST" && url.pathname === "/v4/his/inventory") return handleHisInventory(req, env, rid);
      if (req.method === "POST" && url.pathname === "/v4/iot/ingest") return handleIot(req, env, rid);
      if (req.method === "POST" && url.pathname === "/v4/documents/reserve") return handleR2Reserve(req, env, rid);
      if (req.method === "PUT" && url.pathname.startsWith("/v4/documents/object/")) {
        return handleR2Put(req, env, decodeURIComponent(url.pathname.slice("/v4/documents/object/".length)), rid);
      }
      if (req.method === "POST" && url.pathname === "/v4/ai/runs") return handleAiRun(req, env, rid);
      return json({ error: "NOT_FOUND", request_id: rid }, 404, rid);
    } catch (error) {
      if (error instanceof HttpError) {
        console.warn(JSON.stringify({ event: "gateway_rejected", code: error.code, status: error.status, request_id: rid }));
        return json({ error: error.code, ...(error.safeDetail ? { detail: error.safeDetail } : {}), request_id: rid }, error.status, rid);
      }
      console.error(JSON.stringify({ event: "gateway_unhandled_error", request_id: rid }));
      return json({ error: "GATEWAY_ERROR", request_id: rid }, 500, rid);
    }
  }
};
