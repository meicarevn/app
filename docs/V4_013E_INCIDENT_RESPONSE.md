# MEICARE V4_013E — Incident Response and Rollback Rehearsal

## Operating rule

Protect patients, pharmacy operations and evidence integrity first. V4 remains
shadow/read-only until every commercial gate passes. An incident response may
disable or roll back a V4 route, but it must not promote a readiness flag or
mutate canonical inventory without separate approval.

## Severity and first response

| Severity | Example | Acknowledge target | First safe action |
|---|---|---:|---|
| SEV-1 | Cross-tenant exposure, corrupted canonical ledger, compromised secret | 15 min | Contain route/credential; preserve evidence; notify owners |
| SEV-2 | HIS import unavailable, reconciliation drift, login unavailable | 1 hour | Stop affected integration; retain last known-good read path |
| SEV-3 | Degraded dashboard, delayed non-critical alert, isolated UI defect | 1 business day | Record, communicate workaround, schedule fix |

Targets are internal pilot objectives, not contractual 24/7 support promises.

## Response sequence

1. Open an incident record with timestamp, reporter, organization, request or
   correlation ID, affected component and suspected data window.
2. Classify severity and appoint one incident commander.
3. Preserve logs, R2 evidence keys/checksums, deployment SHA and database
   baseline. Do not copy tokens or patient-identifiable data into tickets.
4. Contain the smallest affected surface:
   - Cloudflare preview: route to the previous known-good deployment;
   - HIS adapter: disable ingestion and keep reconciliation pending;
   - credential: revoke/rotate and invalidate sessions as appropriate;
   - database: stop application writes and seek database-owner approval.
5. Verify production runtime remains at the approved mode.
6. Recover only from a checksum-verified artifact, first on an isolated target.
7. Validate tenant isolation, ledger integrity and core read journeys.
8. Communicate recovery status and residual risk.
9. Close only after evidence review, root cause and corrective actions have owners.

## V4 rollback rehearsal

The rehearsal is non-destructive and must demonstrate:

- the V4_013 preview can be withdrawn without changing production DNS;
- `meicare-platform.pages.dev` remains on the approved baseline;
- `meicare-smart-pharmacy.pages.dev` remains independently reachable;
- database readiness and write/publication modes remain unchanged;
- the prior known-good commit and deployment identifier are recorded;
- a rollback smoke covers login, organization resolution, Dashboard, Smart
  Inventory, Action Center and Production Gate.

If any point cannot be demonstrated, the rehearsal is FAIL and commercial
promotion remains blocked.

## Database-specific incidents

- Never run a dashboard restore as a diagnostic step: restore makes the project
  unavailable and can discard changes after the selected recovery point.
- A V4_013D activation failure uses its reviewed transactional rollback and
  requires advisor plus authenticated/cross-tenant tests before retry.
- If canonical ledger integrity is uncertain, stop downstream projections and
  alert publication. Never repair append-only history with UPDATE or DELETE;
  use an approved counter-event workflow.
- Database backup does not recover Cloudflare R2 or deleted Supabase Storage
  objects. Reconcile object manifests separately.

## Minimum incident evidence

- incident/change ID and severity;
- UTC detection, containment, recovery and closure times;
- affected organizations and data interval;
- commit/deployment/database migration versions;
- request/correlation IDs and redacted log references;
- backup and object-manifest SHA-256 values;
- decisions, approvers and user communications;
- recovery checks and residual risks;
- corrective action owner and due date.
