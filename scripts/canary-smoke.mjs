import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const baseUrl = process.env.CANARY_GATEWAY_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("CANARY_GATEWAY_URL is required");

const suites = new Set((process.env.CANARY_SUITES || "health").split(",").map((x) => x.trim()).filter(Boolean));
const evidence = {
  started_at: new Date().toISOString(),
  gateway_url: baseUrl,
  suites: [...suites],
  results: []
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the selected canary suite`);
  return value;
}

async function record(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    evidence.results.push({ name, status: "PASS", duration_ms: Date.now() - started, detail });
    console.log(`PASS ${name}`);
  } catch (error) {
    evidence.results.push({
      name,
      status: "FAIL",
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function jsonResponse(res) {
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return { body, request_id: res.headers.get("x-request-id") };
}

if (suites.has("health")) {
  await record("health", async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { "x-request-id": `canary-${randomUUID()}` } });
    const { body, request_id } = await jsonResponse(res);
    if (!body || body.status !== "ok") throw new Error("Gateway health response is not ok");
    if (body.mode !== "shadow") throw new Error(`Expected shadow mode, got ${body.mode}`);
    return {
      request_id,
      mode: body.mode,
      iot_auth_configured: body.iot_auth_configured,
      request_guard_configured: body.request_guard_configured,
      r2_configured: body.r2_configured
    };
  });
}

if (suites.has("his")) {
  await record("his-staging", async () => {
    const connectionId = requireEnv("CANARY_HIS_CONNECTION_ID");
    const apiKey = requireEnv("CANARY_HIS_API_KEY");
    const rows = JSON.parse(requireEnv("CANARY_HIS_ROWS_JSON"));
    const payload = JSON.stringify({
      rows,
      observed_at: new Date().toISOString(),
      source_name: "github-canary-smoke",
      coverage_type: process.env.CANARY_HIS_COVERAGE_TYPE || "PARTIAL",
      metadata: { canary: true, run_id: process.env.GITHUB_RUN_ID || null }
    });
    const res = await fetch(`${baseUrl}/v4/his/inventory`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-meicare-connection-id": connectionId,
        "x-meicare-api-key": apiKey,
        "x-meicare-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-idempotency-key": `gh-${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || 1}`
      },
      body: payload
    });
    const { body, request_id } = await jsonResponse(res);
    if (body?.status !== "STAGED") throw new Error("HIS canary did not reach STAGED");
    return {
      request_id,
      import_job_id: body?.staged?.import_job_id || null,
      reconciliation_id: body?.reconciliation_id || null,
      staging_status: body?.staged?.status || null
    };
  });
}

if (suites.has("iot")) {
  await record("iot-auth-and-ingest", async () => {
    const deviceUid = requireEnv("CANARY_IOT_DEVICE_UID");
    const deviceSecret = requireEnv("CANARY_IOT_DEVICE_SECRET");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sequence = Number(process.env.CANARY_IOT_SEQUENCE || Date.now());
    const rawBody = JSON.stringify({
      recorded_at: new Date().toISOString(),
      sequence_number: sequence,
      temperature: Number(process.env.CANARY_IOT_TEMPERATURE || 25),
      humidity: Number(process.env.CANARY_IOT_HUMIDITY || 60),
      battery_voltage: 3.3,
      signal_strength: -60,
      power_status: "MAINS",
      sensor_status: "OK"
    });
    const signature = createHmac("sha256", deviceSecret)
      .update(`${timestamp}.${deviceUid}.${rawBody}`)
      .digest("hex");
    const res = await fetch(`${baseUrl}/v4/iot/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": deviceUid,
        "x-timestamp": timestamp,
        "x-signature": signature
      },
      body: rawBody
    });
    const { body, request_id } = await jsonResponse(res);
    return { request_id, sequence_number: sequence, response_status: body?.status || null };
  });
}

if (suites.has("r2")) {
  await record("r2-reserve-upload-finalize", async () => {
    const jwt = requireEnv("CANARY_USER_JWT");
    const documentId = requireEnv("CANARY_TEST_DOCUMENT_ID");
    const reserveRes = await fetch(`${baseUrl}/v4/documents/reserve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
        "x-idempotency-key": `r2-${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || 1}`
      },
      body: JSON.stringify({
        document_id: documentId,
        file_name: `canary-${Date.now()}.txt`,
        mime_type: "text/plain",
        metadata: { canary: true, run_id: process.env.GITHUB_RUN_ID || null }
      })
    });
    const reserve = await jsonResponse(reserveRes);
    const versionId = reserve.body?.version_id || reserve.body?.id;
    const objectKey = reserve.body?.object_key;
    if (!versionId || !objectKey) throw new Error("Reservation did not return version_id/object_key");
    const content = `MEICARE canary evidence ${new Date().toISOString()}\n`;
    const putRes = await fetch(`${baseUrl}/v4/documents/object/${encodeURIComponent(objectKey)}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${jwt}`,
        "content-type": "text/plain",
        "x-document-version-id": versionId
      },
      body: content
    });
    const uploaded = await jsonResponse(putRes);
    if (uploaded.body?.status !== "AVAILABLE") throw new Error("R2 canary did not finalize AVAILABLE");
    return {
      reserve_request_id: reserve.request_id,
      upload_request_id: uploaded.request_id,
      version_id: versionId,
      object_key: objectKey,
      sha256: uploaded.body?.sha256 || null,
      size: uploaded.body?.size || null
    };
  });
}

if (suites.has("ai")) {
  await record("ai-governed-run-create", async () => {
    const jwt = requireEnv("CANARY_USER_JWT");
    const organizationId = requireEnv("CANARY_ORGANIZATION_ID");
    const res = await fetch(`${baseUrl}/v4/ai/runs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
        "x-idempotency-key": `ai-${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || 1}`
      },
      body: JSON.stringify({
        organization_id: organizationId,
        run_type: "CANARY_VALIDATION",
        model_provider: "NONE",
        model_name: "NO_EXECUTION",
        model_version: "canary",
        input_classification: "L1_INTERNAL",
        input_summary: { canary: true, run_id: process.env.GITHUB_RUN_ID || null },
        data_minimization_note: "Canary creates governance metadata only; no model or domain mutation is executed."
      })
    });
    const { body, request_id } = await jsonResponse(res);
    if (!body?.ai_run_id) throw new Error("AI canary did not return ai_run_id");
    return { request_id, ai_run_id: body.ai_run_id };
  });
}

evidence.completed_at = new Date().toISOString();
evidence.status = evidence.results.every((x) => x.status === "PASS") ? "PASS" : "FAIL";
await writeFile("canary-evidence.json", JSON.stringify(evidence, null, 2));
console.log(`Canary result: ${evidence.status}`);
