# V4_008 — Cloudflare Integration Layer

Status: **prepared for review only; not deployed to production**.

This branch introduces the first Cloudflare Worker gateway for the V4 platform. It is intentionally compatible with the current V4 public RPC contract and keeps the Supabase service-role key server-side only.

## Implemented routes

- `GET /health` — gateway health, currently reports `mode=shadow`.
- `POST /v4/his/inventory` — authenticates an HIS connection with `authenticate_his_connection_v2`, stages observations through `stage_inventory_observation_v4`, then prepares reconciliation with `prepare_inventory_reconciliation_v4`.
- `POST /v4/iot/ingest` — wired to `ingest_iot_reading_v4`, but deliberately fail-closed for device traffic until the per-device credential verifier is implemented. An admin-only token can be used for non-production integration testing.
- `POST /v4/documents/reserve` — user-JWT-authenticated reservation via `reserve_document_version_v4`.
- `PUT /v4/documents/object/{objectKey}` — uploads bytes to the `EVIDENCE_BUCKET` R2 binding and finalizes the document version using file size + SHA-256 supplied by the client.
- `POST /v4/ai/runs` — creates governed AI runs through `create_ai_run_v4`; it does not execute domain mutations.

## Security boundaries

1. `SUPABASE_SERVICE_ROLE_KEY` exists only as a Worker secret.
2. Browser/user routes preserve the original Supabase user JWT so RLS / permission-aware RPC logic remains in force.
3. HIS credentials are verified server-side before the organization/source system are accepted.
4. IoT ingest is fail-closed until the existing encrypted device credential format has a reviewed verifier. We do not compare plaintext secrets against encrypted database material in application code.
5. R2 writes require an authenticated user and an existing reserved document version. Finalization records checksum and size in Postgres.
6. All gateway requests should carry or receive a correlation/request ID; the Worker adds it to metadata where supported.

## Required Cloudflare configuration

Encrypted secrets:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `GATEWAY_ADMIN_TOKEN` (temporary integration-test control only; remove before production IoT enablement)

Bindings/vars:

- `SUPABASE_URL`
- `R2_BUCKET_NAME`
- `EVIDENCE_BUCKET`

## Remaining blockers before CANARY

- Implement and review per-device IoT authentication that matches the current credential provisioning/encryption format.
- Add request-size limits, rate limits, schema validation, checksum recomputation inside the Worker, and replay protection for external callers.
- Add automated tests and CI.
- Deploy a non-production Worker and run HIS/R2/IoT/AI smoke tests against it.
- Mark `integration_layer_ready`, `r2_gateway_ready`, `iot_gateway_ready`, and `ai_orchestrator_ready` only after evidence exists.
- Follow `.github/MEICARE_RELEASE_GATE.md`; do not merge/deploy a material infrastructure change without required founder approvals.
