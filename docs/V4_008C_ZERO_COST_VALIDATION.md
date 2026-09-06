# V4_008C — Zero-Cost Validation Path

Status: **implemented as the no-additional-cost alternative to a paid Supabase development branch**.

## Principle

The production runtime remains `SHADOW`. No production readiness flag is promoted by these checks. Instead of provisioning a paid Supabase development branch, the validation strategy combines:

1. GitHub CI and local-contract checks for the Cloudflare Worker code;
2. transaction-scoped PostgreSQL smoke tests against the current V4 schema;
3. explicit `ROLLBACK` after every database write-path test;
4. post-test residue and ledger-drift verification.

This gives strong contract and data-integrity evidence at zero additional Supabase branch cost, while acknowledging that a final real Cloudflare network/deployment canary is still a later release-gate step.

## Evidence completed on 2026-09-06

### HIS staging → reconciliation

A one-row observation using an existing canonical drug/lot/warehouse was staged inside an explicit transaction:

- organization: current MEICARE organization;
- drug code: `18892`;
- warehouse code: `1`;
- lot: `1330526`;
- expiry: `2029-06-01`;
- quantity on hand: `151200`;
- coverage: `PARTIAL`;
- test marker: `ROLLBACK_ONLY`.

Result before rollback:

- rows: `1`;
- ready rows: `1`;
- blocking rows: `0`;
- warning rows: `1` (missing unit cost, intentionally warning-only);
- staging status: `READY_FOR_REVIEW`;
- reconciliation object created successfully.

The transaction was rolled back. Follow-up query confirmed zero retained test import jobs.

### IoT ingestion + deduplication

A temporary sensor device was created inside an explicit transaction and pointed at the existing warehouse/storage-zone context. Two `ingest_iot_reading_v4` calls were made with the same sequence number and source event key.

Result before rollback:

- first reading: stored successfully;
- second reading: deduplicated successfully;
- retained sensor readings inside transaction: exactly `1`.

The transaction was rolled back. Follow-up query confirmed zero retained test devices.

### Document registry / version integrity

Inside an explicit transaction:

1. a temporary document registry record was created;
2. a document version was reserved;
3. the version was finalized with a 64-character SHA-256 placeholder and explicit file size;
4. the version reached `AVAILABLE` and matched the expected integrity metadata.

The transaction was rolled back. Follow-up query confirmed zero retained test documents.

This validates the database-side R2 registry contract without writing a real R2 object.

### AI governance

Inside an explicit transaction, `create_ai_run_v4` created a governed `ZERO_COST_CANARY` run with `L1_INTERNAL` classification and `ROLLBACK_ONLY` metadata.

The transaction was rolled back. Follow-up query confirmed zero retained test AI runs.

### Inventory invariant

After all rollback smoke tests:

```text
inventory_ledger_drift_v4 rows = 0
```

No canonical inventory mutation was retained.

## What this validates

- V4 HIS observation and reconciliation contracts are executable against the live schema.
- V4 IoT ingestion stores once and deduplicates repeated sequence identity correctly.
- V4 Document Registry reserve/finalize contract works transactionally.
- V4 AI governance run creation works without a model call or domain mutation.
- rollback cleanup leaves no test data residue.
- inventory ledger invariants remain intact.

## What this does NOT yet validate

The zero-cost path does not claim that the following are already production-ready:

- real Cloudflare Worker deployment/network routing;
- real Durable Object behavior under concurrent internet traffic;
- real Cloudflare R2 object upload and orphan cleanup;
- real device HMAC verification through the new `iot-device-auth-v1` adapter;
- real VNPT-HIS connectivity;
- production secret configuration;
- Cloudflare rate-limit behavior at scale.

Those remain separate release-gate items. No readiness flag should be set to true solely because the rollback checks pass.

## Promotion rule

Current expected state remains:

```text
cutover_stage          = SHADOW
inventory_write_mode   = LEGACY
alert_publish_mode     = SHADOW
his_ingestion_mode     = HYBRID
integration_layer_ready = false
r2_gateway_ready        = false
iot_gateway_ready       = false
ai_orchestrator_ready   = false
```

Use the zero-cost validation evidence to continue implementation and frontend integration. Before any production infrastructure/security promotion, follow `.github/MEICARE_RELEASE_GATE.md` and obtain the required founder approval(s).
