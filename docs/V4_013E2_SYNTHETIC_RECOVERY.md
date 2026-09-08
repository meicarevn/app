# V4_013E2 — Synthetic recovery on GitHub Actions

Decision: use an ephemeral standard Linux runner so operators can work from a
Mac or iPad browser. No paid resources or production data export are introduced.

The PR workflow builds PostgreSQL 17 tooling with real age and Python, then runs
the database and harness in a network-none container, without published ports,
host Docker socket, production secrets or persisted checkout credentials.
Dependency downloads happen before this isolated runtime starts.

The checked-in fixture deliberately uses simplified text columns and minimal
Auth/Storage stubs. It is NOT the production schema, an RLS authorization test,
or a full Supabase installation. Source and target databases share one temporary
cluster, so the roles component is a comment, not a role recovery exercise.

The harness dumps the quiescent synthetic database with pg_dump, preserves
migration history, encrypts with an ephemeral age key, rejects a wrong key, and
runs the unchanged E1 restore script. It verifies baseline equality, SQL
invariants and rejection of a nonempty target. E1's fixed source reference is
only a guard label here; there is no connection to the referenced project.
LOCAL means loopback inside the isolated runner container, not the user's Mac.

Only a fixed synthetic summary is published to the Actions job summary. No
archive, SQL dump, private key or database evidence directory is uploaded.
The container and its anonymous database volume are removed even on failure.
Abrupt runner termination also relies on GitHub's disposable VM lifecycle.

Success is SYNTHETIC_RECOVERY_PASS; production recovery remains BLOCKED.
Not covered: Supabase CLI capture, managed extensions, production role grants,
Auth recovery, binary objects/R2, Vault keys, application recovery or production
RTO. Real-data execution requires a separately reviewed destination, custodian,
network design and authorization. Do not add production secrets to this job.

Cost: standard runners on the currently public repository are free under GitHub
Actions policy. Private repository runs must check the included allowance first.
The job is path-filtered, limited to 15 minutes and cancels obsolete PR runs.

Validation: execution evidence is the V4_013E2 Synthetic Recovery Actions job
for the exact commit. Local shell/type/unit checks alone do not prove restore.
