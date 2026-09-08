# V4_013E4 — Supabase CLI capture and isolated managed-schema restore

Synthetic-only PR workflow. No production connection, keys or data are supplied.
CLI 2.117.0 is pinned with its published SHA-256. Local `--help` was inspected
for init/start/stop/db dump. The CLI starts actual Supabase database, Auth and
Storage services; optional Studio/analytics/realtime/edge services are excluded.

Source and target are independent fresh projects, used sequentially to limit
runner resources. The source is destroyed before the target starts. The original
E1 capture script performs all five CLI dumps and age encryption. The original
E1 restore runs against the target through a sidecar sharing its isolated
network namespace. Every database Docker network is disconnected first; the
sidecar asserts loopback is the only interface and has no Docker socket.
Target services are stopped and cron launching disabled before import.

The application fixture remains simplified synthetic tables, while Auth/Storage
schemas and extensions come from Supabase itself. Real Auth password-hash rows,
Storage metadata, custom NOLOGIN role/grants, a tenant-filtered RLS policy and
pgcrypto ciphertext are seeded. Checks validate their recovery, including
cross-tenant read denial, unknown tenant denial and missing write privilege.
The key used for the pgcrypto fixture is intentionally public synthetic material.
No Vault secret/root key is seeded or copied; Vault portability remains unproven.

The fresh target may contain empty CLI migration bookkeeping. The harness
removes only known, verified-empty bookkeeping tables using RESTRICT before
running the unchanged E1 empty-target guard. Populated or unexpected relations
stop the job. No restore guard is bypassed and no dump records are removed.

E3 metadata must match source and target before restoration. This is same-CLI
synthetic compatibility, not compatibility with the managed production project.
CLI-selected database image identity is logged for traceability. Dependency
images and apt tooling must be digest/version locked in a real-data plan.

No backups, keys, baselines or SQL files are uploaded as Actions artifacts. Only
a fixed summary is published. Synthetic SQL/errors may appear in logs; this
workflow must never be reused for production data. Cleanup removes both projects,
volumes, sidecar and temporary key/archive directory even after failure.

PASS means SUPABASE_SYNTHETIC_RECOVERY_PASS, never commercial recovery PASS.
Not covered: production schema/extensions match, Auth service login, Storage/R2
binary content, Vault key portability, full application recovery or production
RTO. Database password-hash verification is not an Auth API smoke test.

Sources reviewed 2026-09-08:
- https://supabase.com/docs/reference/cli/introduction
- https://supabase.com/docs/guides/self-hosting/restore-from-platform
- https://supabase.com/changelog

Current changelog includes managed extension-version behavior changes and
self-hosted gateway/default-PG changes. This workflow selects PG17 explicitly,
compares installed extension metadata and uses the pinned CLI configuration;
it does not upgrade any MEICARE deployment.
