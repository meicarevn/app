# V4_013E3 — Real-data recovery preparation

Status: PREPARATION ONLY; export and real restore are not enabled.
E2 evidence: commit c8c450b56aff4af4f9ded428eaba9b3c043cf31e,
https://github.com/meicarevn/app/actions/runs/34227987437 (success).

## Scope and current evidence

E3 adds a read-only metadata query and an offline target compatibility comparator.
The source query was executed successfully on 2026-09-08. Live metadata stays out
of this public repository. It reads PostgreSQL catalogs only: major version,
installed extensions and Auth/Storage column definitions. It never reads secret
values, application records, cron command bodies or password hashes.

The comparator conservatively requires the same PostgreSQL major, all source
extensions at matching versions/schema, and exact Auth/Storage column/type/null
metadata. A match is necessary, not sufficient: function definitions, extension
configuration, ACLs, constraints, indexes, role semantics, encryption keys and
service versions still require validation. Malformed or empty manifests fail.

No compatible full Supabase target has yet been built or approved. E2's text
fixture and managed-schema stubs are not eligible for a real backup. Production
uses scheduled-job and encrypted-secret capabilities; target scheduling must be
disabled before importing any SQL. Extension installation alone does not prove
key recovery. No Vault/column encryption approval is inferred from E2.

## Proposed execution design (not deployed)

| Item | Concrete proposal | Unresolved prerequisite |
|---|---|---|
| Source | Existing MEICARE project; logical database backup only | Explicit export approval and controlled quiet window |
| Control repository | Dedicated private `meicarevn/recovery-ops` | Repository availability/access and free Actions allowance |
| Compute | One standard Ubuntu runner; full pinned Supabase PG17 image | Image digest, compatible extensions/Auth/Storage, private-repo quota |
| Capture | Separate source-connected capture container using pinned Supabase CLI | CLI behavior/flags validated on full synthetic Supabase first |
| Restore | New container in `--network none`, loopback only, no host socket | Compatible bootstrap and scheduler-disabled proof |
| Backup destination | Existing private MEICARE R2 bucket, proposed prefix `recovery-drills/E3/` | Exact bucket, access policy, size/quota and retention confirmation |
| Key custodian | Founder A (proposed); independent recovery copy under their control | Actual custodian acceptance and recovery-copy verification |
| Review | Founder B reviews the evidence and data scope | Reviewer availability; no self-approved commercial PASS |
| Retention | Proposed encrypted drill evidence: 7 days after review | Written retention decision; preserve at least one verified recovery copy |

The existing public E2 job remains synthetic-only and receives no production
secrets. Do not create a public artifact containing even encrypted backups or
private source metadata. The proposed private job must not execute PR code or
third-party actions after credentials/data are introduced. Pin an independently
reviewed commit and dependencies. A manual trigger alone is not an approval gate.

## Sequence and boundaries

1. Build full Supabase target and test the actual CLI capture path using synthetic
   data. Run the metadata query against it with `psql -X -qAt -v ON_ERROR_STOP=1`
   so the output is a single JSON object. Compare private source/target JSON via
   `python3 scripts/v4-013e3-check-compatibility.py source.json target.json`.
   Disable the target scheduler and prove no outgoing network; check managed
   roles, Auth/Storage version compatibility, Vault and original E1 preflight.
2. Resolve the table's prerequisites. Prepare a specific run record with source,
   runner/provider, exact commit/image, exact R2 object destination, operator,
   custodian, public encryption recipient, quiet window and retention. Obtain
   approval of that concrete record before exporting. Credentials/private keys
   go through the secure operator mechanism, never chat, Git or workflow inputs.
3. Download all dependencies before credential injection. Capture only through
   the approved source connection and enforce a reviewed network allowlist for
   capture. Preserve migration history. The existing before/after manifest is
   not a shared snapshot: require a controlled quiet window, or implement a
   coordinated snapshot first. No writes are paused automatically by this plan.
4. Encrypt both the SQL archive AND accompanying baseline/metadata manifests
   before durable upload. E1 currently leaves baseline CSV/checksums in its local
   evidence directory; do not upload that directory verbatim. Verify immutable
   upload, checksum and download roundtrip, then destroy the capture container
   and remove source credentials before creating the restore container.
5. Pass the encrypted bundle and a temporary decryption identity only to the
   network-none restore container. No source credentials, R2 credentials or
   Docker socket are mounted there. E1 LOCAL guard stays intact. Record stdout
   and stderr privately: psql errors can include actual row data. Publish only
   fixed status codes; do not rely on GitHub secret masking to redact records.
6. Restore in one transaction; compare manifests and validate constraints,
   privileges/RLS, cross-tenant negatives, managed roles and encrypted-column
   recovery. Test Auth using isolated synthetic accounts with outbound email
   disabled. Assess R2/Storage binary object recovery separately from database
   metadata. Measure the complete retrieval-to-application recovery interval;
   E1 script elapsed time alone is not production RTO.
7. Cleanup on success/failure/cancel, verify the encrypted recovery copy remains
   retrievable, and obtain independent review. A DB pass must not set production
   readiness or authorize cutover. Any failed gate retains BLOCKED.

## Stop conditions and cost boundary

Stop before data export for any unknown target compatibility, Vault recovery,
operator identity, storage ACL, free compute/storage allowance or source-window
approval. No paid runner, VPS, Supabase project or billing upgrade is authorized.
R2 being activated does not prove the proposed bucket is private or within quota.
The hosted runner is a data-processing destination and must be named in approval.

## Validation and next gate

Local: TypeScript and 101 Vitest tests pass (19 files), including four Python
compatibility cases. Source metadata SQL executes read-only. Target compatibility
is NOT yet verified. Next technical gate is full Supabase synthetic capture and
restore, before anyone is asked to provide production credentials.

References reviewed 2026-09-08:
- https://supabase.com/docs/guides/self-hosting/restore-from-platform
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

Supabase's CLI performs filtering that raw pg_dump does not. Keep both paths
explicit in evidence. Do not delete mismatching backup rows or relax transaction
failure behavior merely to obtain a passing restore.
