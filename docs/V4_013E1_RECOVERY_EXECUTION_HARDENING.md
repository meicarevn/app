# V4_013E1 — Recovery execution hardening

Status: local implementation; no production export, restore, DDL or deployment.

Update: E1 was pushed and E2 subsequently exercised this restore script with
real PostgreSQL/age and synthetic data. See `V4_013E2_SYNTHETIC_RECOVERY.md` and
`V4_013E3_REAL_RECOVERY_PLAN.md`. The limitations below describe the original
E1 checkpoint; production capture/restore and full Supabase compatibility remain
unverified. E2 CI passed at c8c450b on 2026-09-08.

## Findings corrected

1. E's standard three-part dump omitted `supabase_migrations`, although the
   recovery manifest queries it. Capture now includes history schema and data;
   restore loads all five components in one transaction.
2. Comparing arbitrary project-reference strings did not prove a safe target.
   E1 restricts automatic restore to `LOCAL`, explicit loopback IP and port,
   `/postgres`, no URI query options and no `PG*` environment overrides.
3. A read-only preflight now requires an unused database before decrypt/restore.
   Any application relations, migration relations, Auth users or Storage objects
   block the run. Missing required managed schemas also fails closed.
4. Source baseline needs an independently reviewed SHA-256, as does the archive.
5. Archive members must be exactly five non-empty regular files. Duplicates,
   traversal, symlinks, hardlinks and unexpected files fail before file copying.
6. Evidence directories must be new, outside Git and private to the operator;
   change IDs cannot introduce path traversal. Existing evidence is preserved.
7. Shell tests execute guards, capture and restore control flow using fake
   database/encryption commands. They no longer rely solely on text assertions.
8. Successful database comparison reports `DB_CHECKS_PASS`, never commercial
   recovery PASS. Object, Auth, RTO and independent reviewer gates remain open.

## Additional operator prerequisites

Use a disposable local Supabase/PostgreSQL 17 target matching source extensions
and Auth/Storage versions. No new paid resources are authorized. The operator
must prepare the sandbox with outbound network access disabled, no production
tunnel, no incoming application traffic and jobs/webhooks disabled. A loopback
URL is NOT a sandbox: it can point at a tunnel. URL guards cannot enforce host
firewall/container isolation or prevent trusted SQL from running SQL commands.

Before running the restore script, supply through the normal secure operator
workflow:

- `SOURCE_PROJECT_REF=sgxufmcsnveyyddazwuk`, `RESTORE_PROJECT_REF=LOCAL`;
- `RESTORE_APPROVAL` equal to the approved `DRILL_CHANGE_ID`;
- `ISOLATION_CONFIRMED=NO_EGRESS_NO_TUNNEL` after inspecting the local sandbox;
- `ENCRYPTION_RECOVERY_REVIEWED=YES` after reviewing Vault/column encryption;
- the archive AND source-baseline hashes from reviewed private evidence;
- a fresh evidence directory whose parent already exists.

Do not paste passwords, age private keys or encryption root keys into chat or
GitHub. These approval variables document an operator decision, not technical
proof of network isolation. Real data movement requires separate approval of
the source, target machine, encrypted evidence destination and key custodian.

## Limits that remain

- No real CLI dump, decryption, PostgreSQL restore, or application recovery has
  been executed in E1. Mock tests do not verify encryption or database behavior.
- The new SQL empty-target preflight has not been executed against PostgreSQL
  in this workspace (psql/Docker unavailable). It must pass on the isolated
  target before using a production backup.
- Vault and column-encryption data may depend on an encryption root key outside
  the logical dump. Do not copy or rotate keys automatically; design and approve
  key recovery separately, then verify decryption on the isolated target.
- Source/target manifests compare selected core fields, counts, functions and
  policies, not every byte of every table or all ACLs. Before/after equality is
  a drift check, NOT proof that all dumps shared one PostgreSQL snapshot. Use an
  approved quiescent window or design a coordinated-snapshot backup.
- R2/Storage binary objects, platform settings, Auth smoke tests, role/tenant
  negative tests, RTO measurement and sign-off are separate mandatory checks.
- Existing E baseline digests are historical; new backup runs need new evidence.
- All runtime readiness values remain untouched. A passing local test is not a
  go-live decision or a completed restore drill.

## Validation

Run `python3 test/recovery_execution.py -v`, `npm run check`, `npm test`, and
`bash -n scripts/v4-013e-capture-backup.sh scripts/v4-013e-restore-drill.sh`.
The Vitest suite includes the offline execution test so existing CI picks it up.
Python 3 must be installed on the runner; no new pip/npm dependencies are needed.

Local results: TypeScript PASS; 18 Vitest files / 100 tests PASS, including a
wrapper that runs 14 Python execution tests; shell syntax PASS; npm audit reports
zero vulnerabilities. These are local results, not remote CI or real recovery
evidence. The fake `age` command copies synthetic bytes; encryption is not
claimed to have been tested.

Source: [Supabase CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
reviewed 2026-09-08, including migration-history preservation and encrypted-data
recovery caveats. The current changelog was checked; no infrastructure upgrade
or new deployment is performed here.
