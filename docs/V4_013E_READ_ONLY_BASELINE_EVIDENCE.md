# V4_013E Read-only Baseline Evidence — 2026-09-07

## Scope

Executed against Supabase project `sgxufmcsnveyyddazwuk` using
`scripts/v4-013e-recovery-baseline.sql` and
`scripts/v4-013e-recovery-acceptance.sql` in read-only transactions. Both
transactions ended with `ROLLBACK`; no schema, data, runtime or readiness value
was changed.

## Result

`V4_013E_RESTORE_INVARIANTS_PASS`

| Metric | Value |
|---|---:|
| Applied migrations | 59 |
| Latest applied migration | `20260906072831` |
| Drugs | 921 |
| Drug lots | 1,457 |
| Warehouses | 8 |
| Inventory snapshots | 5 |
| Inventory snapshot lines | 7,359 |
| Inventory ledger events | 1,671 |
| Alerts | 895 |
| Actions | 896 |
| Audit logs | 7,700 |
| Import jobs | 5 |
| Null ledger sequences | 0 |
| Duplicate per-organization ledger sequences | 0 |
| Orphan event warehouse/drug/lot references | 0 |
| Orphan snapshot lines | 0 |
| Non-RLS tables in `public` and `integration` | 0 |

## Digests

| Surface | MD5 digest |
|---|---|
| `public.inventory_events` | `2a38d1870ba067c9a14d000eed680dbb` |
| `public.inventory_snapshot_lines` | `9fd9aa7386d504bcd3e612853ccf763d` |
| `public.drug_lots` | `e3428f6c4031ec21aecfef264c669554` |
| `public.organization_runtime_v4` | `49ebb27e7a6200b7112ee70bbba216bc` |
| User functions | `8be78e75b6ad7d0572cc0a487b3e5c6d` |
| RLS policies | `f039879281af690137426de926c890f9` |

These digests are equality checks for the paired backup/restore drill. They are
not cryptographic signatures and do not replace the SHA-256 checksum of the
encrypted backup artifact.

## Explicit boundary

- V4_013D is not in the applied migration list.
- Runtime remains shadow/legacy and frontend readiness remains false.
- `backup_restore_verified_at` remains `NULL`.
- No backup archive was created in this execution environment.
- No restore target was available, so the commercial restore gate remains BLOCKED.

## V4_013D transactional compatibility check

The complete V4_013D migration was also executed with a 3-second lock timeout
and 30-second statement timeout after replacing its final `COMMIT` with
`ROLLBACK`. Its preconditions, all 13 facade definitions, ACL statements and
postconditions completed without error on the production PostgreSQL 17 schema.

The post-rollback verification returned:

| Check | Value |
|---|---:|
| Existing public `SECURITY DEFINER` functions | 13 |
| Public V4_013D invoker facades retained | 0 |
| Private V4_013D copies retained | 0 |
| V4_013D migration record applied | 0 |

This proves transactional compatibility and rollback isolation. It does not
authorize or substitute for a persistent production migration.

## Advisor state

The security advisor still reports 14 warnings: the 13 accepted V4_013D
`SECURITY DEFINER` findings (expected while D remains unapplied) and leaked
password protection being disabled. Remediation remains gated; no advisor
setting was changed in V4_013E.
