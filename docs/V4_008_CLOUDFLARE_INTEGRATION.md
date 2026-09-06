# V4_008 — Cloudflare Integration Layer

Status: **V4_008B hardening implemented on a review branch; not deployed to production**.

This branch introduces the Cloudflare Worker gateway for the V4 platform. It remains compatible with the current V4 public RPC contract and keeps privileged credentials server-side only.

## Implemented routes

- `GET /health` — reports gateway SHADOW mode plus whether R2, Request Guard and IoT auth adapter bindings are configured.
- `POST /v4/his/inventory` — validates the payload, enforces timestamp freshness and an idempotency key, authenticates the HIS connection, stages observations through `stage_inventory_observation_v4`, then prepares reconciliation through `prepare_inventory_reconciliation_v4`.
- `POST /v4/iot/ingest` — validates the telemetry envelope, checks a 5-minute freshness window, computes the raw request SHA-256, requires a device HMAC signature, delegates secret-aware verification to the reviewed IoT auth adapter, applies replay/rate protection, then calls `ingest_iot_reading_v4`.
- `POST /v4/documents/reserve` — user-JWT-authenticated reservation via `reserve_document_version_v4`, protected by request idempotency.
- `PUT /v4/documents/object/{objectKey}` — verifies that the authenticated user can read the exact reserved document version, requires the R2 object key to match the reservation, computes SHA-256 inside the Worker, compares any optional client checksum, uploads to R2, then finalizes the version with the Worker-computed checksum and size.
- `POST /v4/ai/runs` — creates governed AI runs through `create_ai_run_v4` with idempotency protection. It does not execute domain mutations.

## Request Guard

A Cloudflare Durable Object named `RequestGuard` provides per-scope serialization, basic rate limiting and replay/idempotency protection.

Behavior:

- same idempotency key + same payload hash after completion → cached response;
- same key + different payload hash → conflict;
- concurrent identical request while first request is in progress → conflict/retry;
- failed upstream operation → claim released so a safe retry can proceed;
- completed request evidence retained for up to 24 hours;
- IoT uses the device UID as its guard scope and the sequence number as its request key.

This complements, rather than replaces, database idempotency such as the existing `(device_id, sequence_number)` protection.

## IoT signature contract

The Worker **does not decrypt device credentials** and **does not receive the plaintext device secret**.

Device request headers:

- `x-meicare-timestamp`: Unix timestamp in seconds or milliseconds, maximum clock skew 300 seconds;
- `x-meicare-signature`: HMAC-SHA256 signature generated with the per-device secret.

The signed message for signature version `v1` is:

```text
<device_uid>\n<timestamp_seconds>\n<sha256(raw_http_body)>
```

Because `sequence_number` is inside the raw JSON body, it is covered by the body hash and therefore by the signature.

The Worker calls the configured `IOT_AUTH_URL` with a server-to-server bearer token and sends only:

```json
{
  "signature_version": "v1",
  "device_uid": "ESP01S-001",
  "timestamp": 1788652800,
  "body_sha256": "...",
  "signature": "...",
  "sequence_number": 42
}
```

The adapter must independently reconstruct the canonical message, obtain/decrypt the existing credential in its trusted boundary, compare the HMAC in constant time, verify active/non-revoked credential state, and return only non-secret authentication metadata such as:

```json
{
  "authenticated": true,
  "organization_id": "...",
  "key_version": 2
}
```

If `IOT_AUTH_URL` or `IOT_AUTH_TOKEN` is not configured, `/v4/iot/ingest` fails closed with `503 IOT_AUTH_ADAPTER_NOT_CONFIGURED`.

There is no admin-token bypass in V4_008B.

## Security boundaries

1. `SUPABASE_SERVICE_ROLE_KEY` exists only as a Cloudflare encrypted secret and is never returned to browser/device clients.
2. Browser/user routes preserve the original Supabase user JWT so RLS and permission-aware V4 RPCs remain effective.
3. HIS credentials are authenticated before tenant/source values from the connection are trusted.
4. External HIS traffic requires a fresh timestamp plus `x-idempotency-key`; the raw request hash is recorded in staging metadata.
5. IoT authentication follows `Device UID + timestamp + raw-body SHA-256 + HMAC-SHA256`, with replay protection by device sequence.
6. R2 writes are limited to the exact object key reserved by `document_versions_v4`; arbitrary R2 object-key writes through this route are rejected.
7. R2 checksum and file size used for finalization are computed by the Worker, not trusted from client headers.
8. Internal upstream error bodies are not returned to clients. Responses expose a stable error code and request ID only.
9. Request bodies are bounded: HIS 6 MiB, IoT 16 KiB, user JSON 256 KiB, evidence object 25 MiB.
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

- Implement and review the secret-aware `iot-device-auth-v1` adapter against the existing encrypted credential format/root-key process.
- Run the GitHub CI successfully on the hardened branch.
- Deploy a **non-production** Worker with non-production bindings/secrets and run HIS, R2, IoT and AI smoke tests.
- Verify R2 object cleanup behavior for a rare upload-success/finalize-failure incident and document the runbook.
- Attach Founder A security/infrastructure approval before any production deployment; obtain Founder B approval if pharmacy/clinical workflow behavior changes.
- Only after evidence exists should `integration_layer_ready`, `r2_gateway_ready`, `iot_gateway_ready`, or `ai_orchestrator_ready` be set true.
- Do not promote beyond SHADOW/CANARY without satisfying `.github/MEICARE_RELEASE_GATE.md`.
