# MEICARE V4_013C — Controlled VNPT-HIS Contract

Status: **implemented for review; no live VNPT-HIS connection and no production deployment**.

## Purpose

Convert a VNPT-HIS inventory export into one strict MEICARE pharmacy-inventory observation. The adapter must normalize the hospital export before calling the gateway. The gateway contract exposes only inventory-by-lot fields; named patient, prescription, diagnosis, clinician and medical-record fields are rejected by the allowlist.

This contract reuses the existing V4 platform path:

```text
VNPT-HIS export → controlled adapter → Cloudflare request evidence
                → V4 staging → reconciliation → human review
```

It does not write canonical inventory events and does not change `his_ingestion_mode=HYBRID`.

## Transport

`POST /v4/his/inventory`

Required headers:

- `Content-Type: application/json`
- `X-Meicare-Connection-Id`: provisioned UUID
- `X-Meicare-Api-Key`: connection secret
- `X-Meicare-Timestamp`: current Unix seconds or milliseconds, maximum five-minute skew
- `X-Idempotency-Key`: 8–128 characters from `[A-Za-z0-9._:-]`

The authenticated connection, not the request body, determines the organization and source system.
`X-Idempotency-Key` must equal `batch_id`, binding transport replay protection to the declared source batch.

## Envelope V1

```json
{
  "contract_version": "MEICARE_HIS_INVENTORY_V1",
  "batch_id": "vnpt-20260907-0001",
  "source_sequence": 202609070001,
  "observed_at": "2026-09-07T10:00:00+07:00",
  "exported_at": "2026-09-07T10:05:00+07:00",
  "source_name": "ton-kho-vnpt-20260907.xlsx",
  "coverage_type": "WAREHOUSE_SET_FULL",
  "warehouse_codes": ["KHO-01"],
  "file_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "row_count": 1,
  "rows": [
    {
      "drug_external_code": "18892",
      "drug_name": "Tên thuốc",
      "active_ingredient": "Hoạt chất",
      "strength": "Hàm lượng",
      "unit": "Viên",
      "lot_number": "1330526",
      "expiry_date": "2029-06-01",
      "warehouse_external_code": "KHO-01",
      "warehouse_name": "Kho chính",
      "zone_external_code": "DEFAULT",
      "zone_name": "Khu mặc định",
      "quantity_on_hand": "151200",
      "unit_cost": "2500",
      "tender_number": "Gói thầu",
      "last_issue_at": "2026-09-06"
    }
  ],
  "metadata": {
    "adapter_name": "vnpt-his-export",
    "adapter_version": "1.0.0",
    "export_profile": "INVENTORY_BY_LOT",
    "source_timezone": "Asia/Ho_Chi_Minh",
    "source_file_format": "XLSX"
  }
}
```

No other envelope, metadata or row fields are accepted. Dates use `YYYY-MM-DD`; timestamps use ISO 8601; quantities and costs use non-negative decimal values without thousands separators or exponent notation.

## Coverage and freshness

- `ORGANIZATION_FULL`: complete organization snapshot, with every included warehouse declared.
- `WAREHOUSE_SET_FULL`: complete snapshot for the declared warehouse set.
- `PARTIAL`: controlled subset and a non-empty `partial_reason` is mandatory.
- Every declared warehouse must have at least one row, and every row warehouse must be declared.
- `row_count` must equal the array length.
- `observed_at` cannot be older than 24 hours or more than five minutes in the future.
- `exported_at` cannot precede `observed_at` or be more than five minutes in the future.

## Identity and normalization

Codes and lot numbers are trimmed and upper-cased. A lot-position identity is:

```text
warehouse | zone-or-DEFAULT | drug code | lot number | expiry date
```

Repeated identical positions are retained because the existing reconciliation engine aggregates their quantities; the source row count, unique position count and duplicate-position row count are stored as evidence. Conflicting expiry dates for the same drug-code/lot identity are rejected before staging.

## Evidence

Before database staging, the exact accepted JSON request bytes are written to R2 at a content-addressed key containing:

- server-resolved organization and connection;
- `batch_id`;
- adapter-declared source-artifact `file_sha256`;
- gateway-computed SHA-256 of the exact accepted request bytes.

The R2 write uses a create-only precondition. An existing key is accepted only when its stored request-payload SHA-256 matches; otherwise the request fails with an evidence conflict before database staging.

The response returns only the evidence ID and hashes, not the internal object key. Import-job metadata retains the internal object key, request ID, idempotency key, contract version, batch, sequence and coverage counts for audit correlation.

The original `.xls`/`.xlsx` file remains a separate adapter-side artifact. Its SHA-256 is mandatory but is still a caller claim in this increment; uploading the file, verifying the digest and proving retention are V4_013C follow-up gates before a live connection can pass.

## Failure behavior

- Unsupported or extra fields: reject before authentication-dependent staging.
- Missing R2 binding or evidence-write failure: fail closed; no staging RPC.
- Replayed idempotency key with the same body: return the cached result.
- Replayed key with another body: conflict.
- Staging/reconciliation failure: release the in-progress request claim for a safe retry; retained evidence remains available for incident review.

## Rollback

V4_013C introduces no database migration and does not mutate runtime configuration. Code rollback is the revert of the V4_013C commit. Content-addressed evidence created by an executed canary is retained for audit and is not a canonical inventory record.

## Remaining live-pilot gates

1. Confirm the real VNPT export column mapping using a de-identified hospital sample.
2. Add original `.xls`/`.xlsx` evidence upload and retention verification.
3. Add atomic persistent source-sequence and database-idempotency cursors, including gap/rewind policy.
4. Provision one isolated VNPT-HIS connection and canary credentials.
5. Run negative, replay, stale-data and tenant-isolation tests.
6. Complete a 14-day stable run with reconciliation and zero canonical-ledger drift.
7. Obtain the required security/infrastructure and pharmacy workflow approvals before any promotion.
