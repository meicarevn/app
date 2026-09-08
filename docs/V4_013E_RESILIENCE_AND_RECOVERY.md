# MEICARE V4_013E — Resilience, Backup and Recovery

## Gate status

**PACKAGE READY / RESTORE DRILL BLOCKED**

The source database is healthy and the recovery manifest can be generated
read-only. The Supabase organization is currently on the Free plan. As of the
V4_013E review, the execution environment has neither the Supabase CLI/psql nor
an approved isolated restore target, so no recoverable backup or restore has
been claimed.

`organization_runtime_v4.backup_restore_verified_at` must remain `NULL` until
the complete drill below passes and its evidence is independently reviewed.

## Recovery objectives

| Phase | RPO | RTO | Status |
|---|---:|---:|---|
| Current pre-production / Free plan | Not guaranteed | Not verified | BLOCKED |
| Lighthouse canary after daily encrypted export | 24 hours | 8 hours objective | Must be measured |
| Future PITR-enabled commercial tier | 2 minutes platform objective | To be measured | Out of zero-cost scope |

An objective is not an SLA. MEICARE may advertise or contract an RPO/RTO only
after at least one full backup/restore drill meets the target.

## What the database backup covers

The logical backup contains database roles, schema and database data, including
RLS policies, functions, triggers and Auth database rows supported by the
Supabase dump process. It does not constitute a complete platform backup.

The recovery evidence set must separately inventory:

- Cloudflare R2 objects and their content hashes;
- Supabase Storage objects, if any; database backup contains only their metadata;
- Cloudflare Worker/Pages configuration and routes;
- secrets, OAuth/Auth settings, SMTP, DNS and custom domains;
- deployed Edge Functions and their versions.

Secrets are never committed to Git, copied into the manifest or stored as
plaintext backup evidence.

## Controlled backup procedure

Prerequisites:

1. approved change ID and named operator/reviewer;
2. Supabase CLI, Docker, `psql`, `age`, `tar` and `sha256sum`;
3. session-pooler database URL supplied only as a process environment variable;
4. an `age` recipient controlled by MEICARE;
5. an access-controlled evidence directory outside the repository.

Run `scripts/v4-013e-capture-backup.sh`. The script:

1. captures the deterministic read-only baseline;
2. uses the official Supabase three-part dump: roles, schema and data;
3. captures the baseline again and rejects the backup if relevant state drifted
   during the dump window;
4. packages and encrypts the plaintext files before moving evidence;
5. destroys only its validated temporary directory;
6. emits SHA-256 checksums for the encrypted archive and both baselines.

The operator must record the R2/Storage manifest SHA-256 alongside the database
checksums. A database-only backup cannot pass the complete commercial gate.

## Isolated restore drill

Never restore into production to test a backup. Provision an empty isolated
database or a compatible local self-hosted Supabase target. Paid Supabase
branching is not authorized by this increment.

Run `scripts/v4-013e-restore-drill.sh`. It fails closed when:

- source and restore project references match;
- the restore URL contains the production project reference;
- the encrypted backup checksum differs;
- any dump component is missing;
- restore SQL fails;
- the source and restored manifests differ byte-for-byte;
- ledger, orphan or RLS invariants fail.

The target must not receive real traffic. Delete or securely dispose of the
isolated copy after evidence review, subject to the data-retention policy.

## PASS criteria

V4_013E recovery may be marked PASS only when all are true:

- encrypted archive checksum verified;
- source and restored manifests match exactly;
- restore invariant script returns `V4_013E_RESTORE_INVARIANTS_PASS`;
- R2/Storage object inventory is reconciled or an explicit zero-object result is evidenced;
- Auth, one read-only application login and core dashboard routes are smoke-tested;
- elapsed restore time meets the approved RTO;
- evidence has operator, reviewer, timestamps and change ID;
- recovery copy is disposed of or retained under an approved policy;
- production remained available and unchanged throughout the drill.

Only after review may a separate controlled write populate
`backup_restore_verified_at` and `backup_restore_evidence`. This increment does
not perform that write.

## Current verified baseline

The read-only production check on 2026-09-07 found:

- 1,671 inventory ledger events, all with ledger sequence;
- zero duplicate per-organization ledger sequences;
- zero orphan event warehouse/drug/lot references;
- zero orphan snapshot lines;
- zero non-RLS tables in the exposed `public` and `integration` schemas;
- runtime remains `SHADOW / LEGACY / SHADOW / HYBRID`;
- `frontend_v4_ready=false` and `backup_restore_verified_at=NULL`.

`private.device_credentials` has RLS disabled and Supabase project inspection
flags it as a critical RLS issue. It currently contains zero rows, but this is still an open
defense-in-depth decision: enabling RLS without a compatible service policy can
break IoT provisioning, so remediation requires its own tested change.

## References

- Supabase database backups: https://supabase.com/docs/guides/platform/backups
- Supabase CLI backup/restore: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Supabase restore to self-hosted: https://supabase.com/docs/guides/self-hosting/restore-from-platform
