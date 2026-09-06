import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const encoder = new TextEncoder();
const MAX_RAW_BODY_BYTES = 32_768;

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function decryptDeviceSecret(ciphertext: string, masterKeyBase64: string) {
  const [version, ivBase64, encryptedBase64] = ciphertext.split(":");
  if (version !== "v1" || !ivBase64 || !encryptedBase64) throw new Error("DEVICE_SECRET_FORMAT_INVALID");
  const keyBytes = fromBase64(masterKeyBase64);
  if (keyBytes.byteLength !== 32) throw new Error("DEVICE_MASTER_KEY_INVALID");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivBase64) },
    key,
    fromBase64(encryptedBase64)
  );
  return new TextDecoder().decode(plaintext);
}

async function verifyHmac(secret: string, canonical: string, supplied: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
  return timingSafeEqual(expected.toLowerCase(), supplied.toLowerCase());
}

function secretKey() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("SUPABASE_SECRET_KEY_UNAVAILABLE");
  return legacy;
}

Deno.serve(async (request: Request) => {
  const requestId = request.headers.get("X-Request-Id") ?? crypto.randomUUID();
  if (request.method !== "POST") return response({ error: "METHOD_NOT_ALLOWED", request_id: requestId }, 405);

  const configuredToken = Deno.env.get("IOT_AUTH_TOKEN");
  const suppliedAuthorization = request.headers.get("Authorization") ?? "";
  const suppliedToken = suppliedAuthorization.startsWith("Bearer ") ? suppliedAuthorization.slice(7) : "";
  if (!configuredToken || !suppliedToken || !timingSafeEqual(configuredToken, suppliedToken)) {
    return response({ error: "UNAUTHORIZED", request_id: requestId }, 401);
  }

  try {
    const payload = await request.json() as Record<string, unknown>;
    const deviceUid = typeof payload.device_uid === "string" ? payload.device_uid.trim() : "";
    const timestamp = typeof payload.timestamp === "string" ? payload.timestamp : String(payload.timestamp ?? "");
    const rawBody = typeof payload.raw_body === "string" ? payload.raw_body : "";
    const signature = typeof payload.signature === "string" ? payload.signature.trim() : "";
    const suppliedBodyHash = typeof payload.body_sha256 === "string" ? payload.body_sha256.trim().toLowerCase() : "";
    const sequenceNumber = payload.sequence_number;

    if (!deviceUid || deviceUid.length > 128 || !/^\d{10}$/.test(timestamp) || !/^[a-fA-F0-9]{64}$/.test(signature)) {
      return response({ error: "AUTH_PAYLOAD_INVALID", request_id: requestId }, 422);
    }
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return response({ error: "TIMESTAMP_EXPIRED", request_id: requestId }, 401);
    }
    if (encoder.encode(rawBody).byteLength > MAX_RAW_BODY_BYTES || !rawBody) {
      return response({ error: "RAW_BODY_INVALID", request_id: requestId }, 422);
    }

    const computedBodyHash = await sha256Hex(rawBody);
    if (suppliedBodyHash && !timingSafeEqual(computedBodyHash, suppliedBodyHash)) {
      return response({ error: "BODY_HASH_MISMATCH", request_id: requestId }, 401);
    }

    let telemetry: Record<string, unknown>;
    try {
      telemetry = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return response({ error: "JSON_INVALID", request_id: requestId }, 422);
    }
    if (!Number.isInteger(telemetry.sequence_number) || telemetry.sequence_number !== sequenceNumber) {
      return response({ error: "SEQUENCE_MISMATCH", request_id: requestId }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL");
    if (!url) throw new Error("SUPABASE_URL_UNAVAILABLE");
    const admin = createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

    const [{ data: authRows, error: authError }, { data: masterKey, error: keyError }] = await Promise.all([
      admin.rpc("iot_get_device_auth", { p_device_uid: deviceUid }),
      admin.rpc("get_iot_device_master_key")
    ]);
    const auth = authRows?.[0];
    if (authError || !auth || !auth.active || auth.revoked_at || auth.device_status === "REVOKED") {
      return response({ error: "DEVICE_NOT_AUTHORIZED", request_id: requestId }, 401);
    }
    if (keyError || typeof masterKey !== "string") throw new Error("DEVICE_MASTER_KEY_UNAVAILABLE");

    const deviceSecret = await decryptDeviceSecret(auth.encrypted_secret, masterKey);
    const canonical = `${timestamp}.${deviceUid}.${rawBody}`;
    if (!await verifyHmac(deviceSecret, canonical, signature)) {
      return response({ error: "SIGNATURE_INVALID", request_id: requestId }, 401);
    }

    return response({
      authenticated: true,
      organization_id: auth.organization_id,
      device_id: auth.device_id,
      device_uid: auth.device_uid,
      key_version: auth.key_version,
      body_sha256: computedBodyHash,
      signature_version: "legacy-v1",
      request_id: requestId
    });
  } catch (error) {
    console.error("IoT device auth failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error)
    });
    return response({ error: "IOT_AUTH_FAILED", request_id: requestId }, 500);
  }
});
