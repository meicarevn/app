export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  GATEWAY_ADMIN_TOKEN: string;
  R2_BUCKET_NAME: string;
  EVIDENCE_BUCKET: R2Bucket;
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

const json = (body: Json, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const requestId = (req: Request) => req.headers.get("x-request-id") || crypto.randomUUID();

async function rpc(env: Env, fn: string, body: Record<string, unknown>, bearer?: string) {
  const key = bearer || env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: bearer ? env.SUPABASE_ANON_KEY : env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${key}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`${fn}:${res.status}:${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  return parsed;
}

function bearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

async function verifyUser(env: Env, token: string) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("UNAUTHORIZED");
  return res.json();
}

async function handleHisInventory(req: Request, env: Env) {
  const connectionId = req.headers.get("x-meicare-connection-id");
  const apiKey = req.headers.get("x-meicare-api-key");
  if (!connectionId || !apiKey) return json({ error: "HIS_CREDENTIALS_REQUIRED" }, 401);

  const auth = await rpc(env, "authenticate_his_connection_v2", {
    p_connection_id: connectionId,
    p_api_key: apiKey
  }) as Record<string, unknown>;

  const body = await req.json() as Record<string, unknown>;
  const staged = await rpc(env, "stage_inventory_observation_v4", {
    p_organization_id: auth.organization_id,
    p_source_system: auth.source_system,
    p_rows: body.rows,
    p_observed_at: body.observed_at,
    p_source_name: body.source_name || "cloudflare-gateway",
    p_coverage_type: body.coverage_type || "WAREHOUSE_SET_FULL",
    p_file_sha256: body.file_sha256 || null,
    p_metadata: { ...(body.metadata as Record<string, unknown> || {}), gateway_request_id: requestId(req) }
  }) as Record<string, unknown>;

  const importJobId = staged.import_job_id;
  const reconciliationId = importJobId
    ? await rpc(env, "prepare_inventory_reconciliation_v4", { p_import_job_id: importJobId })
    : null;

  return json({ status: "STAGED", staged, reconciliation_id: reconciliationId }, 202);
}

async function handleIot(req: Request, env: Env) {
  // Per-device credential verification must be performed by the device-auth adapter.
  // This endpoint deliberately refuses unauthenticated direct ingest until that adapter is enabled.
  const admin = req.headers.get("x-gateway-admin-token");
  if (!admin || admin !== env.GATEWAY_ADMIN_TOKEN) return json({ error: "IOT_DEVICE_AUTH_ADAPTER_REQUIRED" }, 503);
  const body = await req.json() as Record<string, unknown>;
  const result = await rpc(env, "ingest_iot_reading_v4", {
    p_device_uid: body.device_uid,
    p_recorded_at: body.recorded_at,
    p_sequence_number: body.sequence_number,
    p_temperature: body.temperature ?? null,
    p_humidity: body.humidity ?? null,
    p_battery_voltage: body.battery_voltage ?? null,
    p_signal_strength: body.signal_strength ?? null,
    p_power_status: body.power_status ?? null,
    p_sensor_status: body.sensor_status ?? null,
    p_reading_kind: body.reading_kind || "CHANGE",
    p_source_event_key: body.source_event_key || null,
    p_metadata: { ...(body.metadata as Record<string, unknown> || {}), gateway_request_id: requestId(req) }
  });
  return json(result as Json, 202);
}

async function handleR2Reserve(req: Request, env: Env) {
  const token = bearer(req);
  if (!token) return json({ error: "UNAUTHORIZED" }, 401);
  await verifyUser(env, token);
  const body = await req.json() as Record<string, unknown>;
  const reservation = await rpc(env, "reserve_document_version_v4", {
    p_document_id: body.document_id,
    p_file_name: body.file_name,
    p_mime_type: body.mime_type || null,
    p_storage_bucket: env.R2_BUCKET_NAME,
    p_source_metadata: { ...(body.metadata as Record<string, unknown> || {}), gateway_request_id: requestId(req) }
  }, token);
  return json(reservation as Json, 201);
}

async function handleR2Put(req: Request, env: Env, objectKey: string) {
  const token = bearer(req);
  if (!token) return json({ error: "UNAUTHORIZED" }, 401);
  await verifyUser(env, token);
  if (!objectKey) return json({ error: "OBJECT_KEY_REQUIRED" }, 400);
  const checksum = req.headers.get("x-content-sha256");
  const versionId = req.headers.get("x-document-version-id");
  if (!checksum || !versionId) return json({ error: "VERSION_AND_CHECKSUM_REQUIRED" }, 400);
  const bytes = await req.arrayBuffer();
  await env.EVIDENCE_BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: req.headers.get("content-type") || "application/octet-stream" },
    customMetadata: { version_id: versionId, sha256: checksum }
  });
  await rpc(env, "finalize_document_version_v4", {
    p_version_id: versionId,
    p_file_size_bytes: bytes.byteLength,
    p_checksum_sha256: checksum
  }, token);
  return json({ status: "AVAILABLE", version_id: versionId, object_key: objectKey, size: bytes.byteLength });
}

async function handleAiRun(req: Request, env: Env) {
  const token = bearer(req);
  if (!token) return json({ error: "UNAUTHORIZED" }, 401);
  await verifyUser(env, token);
  const body = await req.json() as Record<string, unknown>;
  const id = await rpc(env, "create_ai_run_v4", {
    p_organization_id: body.organization_id,
    p_run_type: body.run_type,
    p_model_provider: body.model_provider || null,
    p_model_name: body.model_name || null,
    p_model_version: body.model_version || null,
    p_prompt_template_version: body.prompt_template_version || null,
    p_tool_policy_version: body.tool_policy_version || null,
    p_input_classification: body.input_classification || "L1_INTERNAL",
    p_input_hash: body.input_hash || null,
    p_input_summary: body.input_summary || {},
    p_data_minimization_note: body.data_minimization_note || null,
    p_correlation_id: body.correlation_id || crypto.randomUUID(),
    p_initiated_by: null
  });
  return json({ ai_run_id: id }, 201);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json({ status: "ok", service: "meicare-v4-gateway", mode: "shadow" });
      }
      if (req.method === "POST" && url.pathname === "/v4/his/inventory") return handleHisInventory(req, env);
      if (req.method === "POST" && url.pathname === "/v4/iot/ingest") return handleIot(req, env);
      if (req.method === "POST" && url.pathname === "/v4/documents/reserve") return handleR2Reserve(req, env);
      if (req.method === "PUT" && url.pathname.startsWith("/v4/documents/object/")) {
        return handleR2Put(req, env, decodeURIComponent(url.pathname.slice("/v4/documents/object/".length)));
      }
      if (req.method === "POST" && url.pathname === "/v4/ai/runs") return handleAiRun(req, env);
      return json({ error: "NOT_FOUND" }, 404);
    } catch (e) {
      const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
      return json({ error: "GATEWAY_ERROR", detail: message, request_id: requestId(req) }, message === "UNAUTHORIZED" ? 401 : 500);
    }
  }
};
