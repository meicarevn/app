# V4_008C — Non-production Canary Validation

Status: **prepared, not executed**.

Goal: prove the hardened V4 gateway end-to-end in an isolated non-production environment before any production merge/deploy or readiness-flag change.

## Environment model

Use a dedicated Supabase development branch plus a dedicated Cloudflare canary Worker/R2 namespace. Production project `sgxufmcsnveyyddazwuk` remains untouched.

Required isolation:

- fresh Supabase development branch created from production migrations, without production data;
- canary-only organization, users, HIS connection, IoT device and document registry rows;
- canary Cloudflare Worker URL;
- separate canary R2 bucket or object-key prefix that cannot collide with production evidence;
- dedicated `IOT_AUTH_TOKEN` shared only by the canary Worker and canary `iot-device-auth-v1` adapter;
- no production service URL, production user JWT or production device credential in canary secrets.

## Smoke suites

The repository contains `scripts/canary-smoke.mjs` and the manual GitHub workflow `V4 Gateway Canary Smoke`.

### health

Pass criteria:

- HTTP 200;
- `status=ok`;
- `mode=shadow`;
- request ID returned;
- expected bindings reported as configured for suites being tested.

### HIS

Input: one or more canary inventory rows supplied through `CANARY_HIS_ROWS_JSON`.

Pass criteria:

- HIS credential authentication succeeds;
- observation reaches V4 staging;
- response status is `STAGED`;
- an import job is returned;
- reconciliation ID is returned when preparation succeeds;
- production inventory ledger is not touched.

Data-integrity checks after the run:

- observation exists only in the development branch;
- duplicate request using the same idempotency key creates no additional import job;
- same idempotency key with a different payload is rejected;
- an expiry conflict remains BLOCKING and does not mutate canonical lot expiry;
- `inventory_ledger_drift_v4` remains zero after any approved canary reconciliation exercise.

### IoT

The smoke runner generates the deployed ESP-compatible signature:

```text
HMAC-SHA256(timestamp.device_uid.raw_json_body)
```

Pass criteria:

- 5-minute freshness validation passes for current timestamp;
- `iot-device-auth-v1` authenticates the existing encrypted credential format;
- sequence-based replay guard is active;
- valid telemetry reaches `ingest_iot_reading_v4`;
- duplicate sequence does not create duplicate canonical readings;
- stale timestamp, wrong HMAC and body/header device mismatch are rejected.

### R2

Pass criteria:

- authenticated canary user reserves a document version;
- Worker accepts only the exact reserved object key;
- Worker computes SHA-256 and size internally;
- version reaches `AVAILABLE`;
- persisted checksum equals the uploaded object checksum;
- arbitrary/unreserved key write is rejected.

Incident test to execute manually once:

1. simulate upload success followed by finalization failure;
2. confirm object remains detectable as orphaned evidence;
3. execute the cleanup runbook without deleting an object referenced by an `AVAILABLE` version.

### AI

Pass criteria:

- governed `CANARY_VALIDATION` run can be created;
- no model call is required;
- no inventory/document/permission mutation occurs;
- run carries correlation/audit metadata.

## GitHub canary environment

Create a GitHub environment named `canary` and configure:

Variables:

- `CANARY_GATEWAY_URL`
- `CANARY_IOT_SEQUENCE`
- `CANARY_TEST_DOCUMENT_ID`
- `CANARY_ORGANIZATION_ID`

Secrets:

- `CANARY_HIS_CONNECTION_ID`
- `CANARY_HIS_API_KEY`
- `CANARY_HIS_ROWS_JSON`
- `CANARY_IOT_DEVICE_UID`
- `CANARY_IOT_DEVICE_SECRET`
- `CANARY_USER_JWT`

The workflow has no deploy step. It validates an already deployed non-production gateway and uploads `canary-evidence.json` as release evidence.

## Gate sequence

1. Create isolated Supabase development branch.
2. Deploy `iot-device-auth-v1` to that branch only.
3. Create minimal canary fixtures: organization, permissions/user, HIS connection, IoT device/credential, document registry entry and known drug/warehouse/lot rows.
4. Deploy Cloudflare Worker in SHADOW mode to a canary service and bind canary R2 + RequestGuard.
5. Configure GitHub `canary` environment.
6. Run `health` suite.
7. Run `his,iot,r2,ai` suites.
8. Run negative/replay tests.
9. Verify tenant isolation, audit evidence and `inventory_ledger_drift_v4=0`.
10. Attach evidence to the V4_008 PR.
11. Founder A reviews infrastructure/security evidence before any production promotion; Founder B reviews if any pharmacy/clinical behavior is altered.

## Promotion rule

Do **not** set any of these true merely because CI passes:

- `integration_layer_ready`
- `r2_gateway_ready`
- `iot_gateway_ready`
- `ai_orchestrator_ready`

A flag becomes eligible only after its corresponding canary suite passes with retained evidence and the required founder gate is satisfied.

Production remains SHADOW until a separate, explicitly approved promotion step.
