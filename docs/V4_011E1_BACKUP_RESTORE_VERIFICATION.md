# V4_011E1 — Backup/Restore Verification

Status: **PREPARATION COMPLETE / ACTUAL RESTORE DRILL PENDING EXPLICIT FOUNDER A DOWNTIME APPROVAL**

Issue: #37

## Purpose

Close the hard `BACKUP_RESTORE_EVIDENCE_REQUIRED` blocker identified by V4_011E without changing global production routing, runtime readiness flags, inventory truth, alert publishing, permissions, RLS, or pharmacy semantics.

This work is fail-closed: preparation evidence must never be interpreted as a successful restore.

## Platform facts

The Supabase organization currently uses the **Free** plan. Current Supabase documentation states that automatic daily backups are provided for Pro, Team, and Enterprise projects. Free projects are advised to regularly create logical exports with `supabase db dump` and keep off-site backups.

Relevant official documentation:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/reference/cli/supabase-db-dump

Supabase also documents that database backups do **not** restore object payloads stored through the Storage API; only database metadata is included. MEICARE Cloudflare R2 evidence therefore remains a separate recovery domain and must have its own backup/retention/recovery evidence.

## Current read-only production baseline

Captured at `2026-09-06T14:14:43.983493Z` from project `sgxufmcsnveyyddazwuk`.

- PostgreSQL: 17.6
- database size at capture: 62,942,355 bytes
- migration count: 59
- latest migration: `20260906072831`
- Supabase Storage buckets: 0
- Supabase Storage objects: 0
- RLS policies in `public` + `integration`: 160
- inventory intelligence projection rows: 2,244
- ledger drift rows: 0
- runtime: SHADOW / LEGACY / SHADOW / HYBRID
- `frontend_v4_ready=false`
- `integration_layer_ready=false`
- `r2_gateway_ready=false`
- `iot_gateway_ready=false`
- `ai_orchestrator_ready=false`
- `backup_restore_verified_at=null`

Detailed row counts and content hashes are stored in:
`evidence/v4-011e1/production-restore-manifest-2026-09-06.json`.

This snapshot is preparation evidence only. An actual backup artifact must be created later, and a **fresh manifest must be captured immediately before that backup** so that restore verification compares against the correct point in time.

## Restore verification mechanics

`scripts/v4-011e1-restore-manifest.sql` generates the database-side manifest using read-only queries. It records:

- migration chain markers;
- selected critical entity row counts;
- stable content hashes of selected critical entities;
- RLS policy count;
- Supabase Storage metadata counts;
- runtime safety state;
- inventory projection count;
- ledger drift.

`scripts/v4-011e1-compare-manifests.cjs` compares the source manifest with the restored manifest and fails closed on any mismatch in the controlled comparison set.

Database size and capture timestamps are intentionally not equality gates because a restored database can differ physically while remaining logically equivalent.

## Preferred actual drill — zero-cost isolated restore

Because the project is on the Free plan and the user previously chose not to incur Supabase branch cost, the preferred verification path is:

1. Capture a fresh source manifest.
2. Create a logical database backup with the Supabase CLI (`supabase db dump`) from an authorized operator workstation.
3. Calculate and record a cryptographic checksum for the backup artifact.
4. Restore the artifact into an isolated local PostgreSQL/Supabase-compatible environment.
5. Run the same restore-manifest query against the isolated restored database.
6. Compare source and restored manifests.
7. Run application-level smoke checks that do not mutate production.
8. Record backup time, restore start/end time, artifact checksum, RPO, RTO, restore target, operator, and comparison result.

This path provides restore evidence without introducing production downtime or paid Supabase branch cost.

## Alternative drill — Free project pause/restore

Supabase documents pause/restore for Free-tier projects. This causes production downtime and may affect availability while the platform restores the project.

This option is **not authorized by this preparation PR**. It requires all of the following before execution:

- explicit Founder A approval;
- declared maintenance window;
- downtime communication plan;
- fresh pre-pause manifest;
- application/API smoke checklist;
- rollback/escalation owner;
- confirmation that no critical HIS ingestion or pharmacy workflow is active during the window.

The production project must not be paused from an AI workflow based only on a generic “continue” instruction.

## PASS criteria for `BACKUP_RESTORE_EVIDENCE_REQUIRED`

The blocker can be closed only when durable evidence shows all of the following:

- a concrete backup artifact or platform backup/restore event exists;
- backup timestamp is recorded;
- artifact checksum is recorded when a logical dump is used;
- restore target is isolated or the production maintenance-window restore is explicitly approved;
- restore start/end timestamps are recorded;
- restore completes successfully;
- source and restored migration count/latest version match;
- critical entity row counts and content hashes match the selected backup point;
- ledger drift is 0 after restore;
- inventory intelligence projection is restored to the expected snapshot state;
- runtime safety state remains SHADOW / LEGACY / SHADOW / HYBRID for this release stage;
- `frontend_v4_ready` remains false during V4_011E1;
- RLS/auth/application read smoke is documented;
- R2/object-storage recovery scope is explicitly documented separately;
- RPO and RTO are calculated from observed timestamps;
- evidence is attached to Issue #37 and the V4_011E gate evidence chain.

## Failure criteria

Any one of these keeps the blocker open:

- no actual backup artifact/event;
- restore not actually executed;
- incomplete or unverifiable checksum/timestamps;
- row-count/content-hash mismatch without explained snapshot boundary;
- ledger drift greater than zero;
- runtime/readiness unexpectedly changes;
- authentication or tenant-isolation smoke failure;
- restore requires production downtime but lacks Founder A approval;
- object-storage recovery is assumed from a database-only restore.

## Current decision

`BACKUP_RESTORE_EVIDENCE_REQUIRED` remains **BLOCKING**.

Preparation is ready for an actual isolated logical restore drill, but the available connected tools do not expose the database password/authorized CLI workstation needed to create a real `db dump` artifact, and the production pause/restore path is intentionally held behind explicit Founder A downtime approval.

## Non-scope

No global production Pages deploy. No `frontend_v4_ready=true`. No Supabase migration. No inventory-write cutover. No alert-publish cutover. No pharmacy semantic change. No IAM/RLS/permission mutation. No production pause or restore during preparation.
