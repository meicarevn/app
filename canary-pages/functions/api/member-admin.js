const UPSTREAM = "https://sgxufmcsnveyyddazwuk.supabase.co/functions/v1/meicare-member-admin-v4";
const PUBLISHABLE = "sb_publishable_9xbWYiMtnriBmFwuiGp8Qw_FNTB8NFc";
const MAX_BODY = 32768;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export async function onRequestPost({ request }) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  if (request.headers.get("x-meicare-canary") !== "V4_009G") return json({ error: "CANARY_HEADER_REQUIRED", request_id: requestId }, 403);
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "AUTH_REQUIRED", request_id: requestId }, 401);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY) return json({ error: "PAYLOAD_TOO_LARGE", request_id: requestId }, 413);
  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: "JSON_INVALID", request_id: requestId }, 400); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "JSON_OBJECT_REQUIRED", request_id: requestId }, 400);

  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      authorization,
      apikey: PUBLISHABLE,
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-meicare-canary": "V4_009G"
    },
    body: JSON.stringify(payload)
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId
    }
  });
}

export function onRequest() {
  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}