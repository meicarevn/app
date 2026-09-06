# V4_008 — Cloudflare Integration Layer

Status: **V4_008B hardening implemented on a review branch; not deployed to production**.

This branch introduces the Cloudflare Worker gateway for the V4 platform. It remains compatible with the current V4 public RPC contract and preserves the already deployed ESP-01S credential/signing format.

## Implemented routes

- `GET /health` — reports gateway SHADOW mode plus whether R2, Request Guard and IoT auth adapter bindings are configured.
- `POST /v4/his/inventory` — validates the payload, enforces timestamp freshness and an idempotency key, authenticates the HIS connection, stages observations through `stage_inventory_observation_v4`, then prepares reconciliation through `prepare_inventory_reconciliation_v4`.
- `POST /v4/iot/ingest` — validates telemetry, checks a 5-minute freshness window, computes the raw request SHA-256, requires the existing per-device HMAC signature, delegates secret-aware verification to `iot-device-auth-v1`, applies replay/rate protection, then calls `ingest_iot_reading_v4`.
- `POST /v4/documents/reserve` — user-JWT-authenticated reservation via `reserve_document_version_v4`, protected by request idempotency.
- `PUT /v4/documents/object/{objectKey}` — verifies that the authenticated user can read the exact reserved document version, requires the R2 object key to match the reservation, computes SHA-256 inside the Worker, compares any optional client checksum, uploads to R2, then finalizes the version with the Worker-computed checksum and size.
- `POST /v4/ai/runs` — creates governed AI runs through `create_ai_run_v4` with idempotency protection. It does not execute domain mutations.

## Request Guard

A Cloudflare Durable Object named `RequestGuard` provides per-scope serialization, basic rate limiting and replay/idempotency protection.

Behavior:

- same idempotency key + same payload hash after completion → cached response;
- same key + different payload hash → conflict;
- concurrent identical request while the first request is in progress → conflict/retry;
- failed upstream operation → claim released so a safe retry can proceed;
- completed request evidence retained for up to 24 hours;
- IoT uses the device UID as its guard scope and the device sequence number as its request key.

This complements, rather than replaces, database idempotency such as the existing `(device_id, sequence_number)` protection.

## IoT compatibility contract

The current production provisioning function already issues a per-device secret and tells firmware to sign:

```text
<unix_timestamp>.<device_id>.<raw_json_body>
```

with HMAC-SHA256. V4_008B deliberately preserves that contract so existing ESP firmware does not need a credential/signing migration merely because the gateway changes.

Accepted device headers are the existing names:

- `X-Device-Id`
- `X-Timestamp` — exactly 10 Unix-second digits; maximum skew 300 seconds
- `X-Signature` — 64 hex characters, HMAC-SHA256

The `x-meicare-*` aliases are also accepted by the Worker for forward compatibility.

The Worker does **not** decrypt device credentials and does **not** receive the plaintext device secret. It reads the raw body bytes, computes SHA-256 for audit/idempotency, and sends the following over a server-to-server authenticated call to `iot-device-auth-v1`:

```json
{
  "signature_version": "legacy-v1",
  "device_uid": "ESP01S-001",
  "timestamp": "1788652800",
  "raw_body": "{...exact bytes decoded as UTF-8...}",
  "body_sha256": "...",
  "signature": "...",
  "sequence_number": 42
}
```

The adapter source is included at:

```text
supabase/functions/iot-device-auth-v1/index.ts
```

Inside the trusted Supabase boundary it:

1. authenticates the Cloudflare-to-adapter call with a dedicated `IOT_AUTH_TOKEN`;
2. reads the active credential through `iot_get_device_auth`;
3. retrieves the existing master key through `get_iot_device_master_key`;
4. decrypts the existing `v1:<base64 iv>:<base64 ciphertext>` credential using AES-256-GCM;
5. independently recomputes the body hash;
6. verifies `HMAC-SHA256(timestamp.device_uid.raw_body)` using constant-time comparison;
7. returns only non-secret metadata (`organization_id`, `device_id`, `key_version`).

The adapter therefore matches the already deployed `meicare-iot-provision` / `meicare-iot-ingestion` cryptographic format instead of inventing a second credential system.

If `IOT_AUTH_URL` or `IOT_AUTH_TOKEN` is absent, `/v4/iot/ingest` fails closed with `503 IOT_AUTH_ADAPTER_NOT_CONFIGURED`.

There is no admin-token bypass in V4_008B.

## Security boundaries

1. `SUPABASE_SERVICE_ROLE_KEY` exists only as a Cloudflare encrypted secret and is never returned to browser/device clients.
2. Browser/user routes preserve the original Supabase user JWT so RLS and permission-aware V4 RPCs remain effective.
3. HIS credentials are authenticated before tenant/source values from the connection are trusted.
4. External HIS traffic requires a fresh timestamp plus `x-idempotency-key`; the raw request hash is recorded in staging metadata.
5. IoT uses the existing `Device ID + timestamp + raw JSON body + HMAC-SHA256` format, while Request Guard adds replay/rate control by device sequence.
6. R2 writes are limited to the exact object key reserved by `document_versions_v4`; arbitrary R2 object-key writes through this route are rejected.
7. R2 checksum and file size used for finalization are computed by the Worker, not trusted from client headers.
8. Internal upstream error bodies are not returned to clients. Responses expose a stable error code and request ID only.
9. Request bodies are bounded: HIS 6 MiB, IoT 32 KiB, user JSON 256 KiB, evidence object 25 MiB.
10. All gateway responses include `x-request-id`; supported writes also propagate the request/hash into metadata for audit correlation.

## Required Cloudflare configuration

Encrypted secrets:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `IOT_AUTH_TOKEN`

Bindings/vars:

- `SUPABASE_URL`
- `R2_BUCKET_NAME`
- `IOT_AUTH_URL`
- `EVIDENCE_BUCKET` (R2)
- `REQUEST_GUARD` (Durable Object)

`GATEWAY_ADMIN_TOKEN` from the initial scaffold is removed.

## Automated checks

The branch contains `V4 Gateway CI`, which runs:

1. TypeScript typecheck;
2. unit tests for SHA-256, timestamp freshness, idempotency keys, HIS envelope validation and IoT envelope validation.

The workflow deliberately contains no deploy step.

## Remaining blockers before CANARY

- Security-review the `iot-device-auth-v1` source and configure its dedicated `IOT_AUTH_TOKEN`; do not reuse a device secret or browser token.
- Run the GitHub CI successfully on the hardened branch.
- Deploy the auth adapter and Worker to a **non-production** environment and run HIS, R2, IoT and AI smoke tests.
- Verify R2 object cleanup behavior for a rare upload-success/finalize-failure incident and document the runbook.
- Attach Founder A security/infrastructure approval before any production deployment; obtain Founder B approval if pharmacy/clinical workflow behavior changes.
- Only after evidence exists should `integration_layer_ready`, `r2_gateway_ready`, `iot_gateway_ready`, or `ai_orchestrator_ready` be set true.
- Do not promote beyond SHADOW/CANARY without satisfying `.github/MEICARE_RELEASE_GATE.md`.
