# MEICARE V4_014B — Commercial Care State Machine

Status: **SOURCE PACKAGE / NOT APPLIED TO PRODUCTION**

Branch: `v4-014b-care-state-machine`

Parent increment: V4_014A Care Queue read layer.

## Purpose

V4_014B turns the MEICARE Pharmacy care-loop semantics into a commercial
database contract while preserving the current V4 inventory truth and runtime
boundaries.

The state chain is:

`policy/version → signal → human decision → conditional owner/SLA → action → verification → evidence`

This increment is deliberately database-first. It does not add browser mutation
controls and it does not apply DDL to the paused commercial Supabase project.

## Canonical data boundary

Canonical care data is stored in the non-exposed `private` schema:

- `care_policy_versions_v4`
- `care_signals_v4`
- `care_cases_v4`
- `care_case_events_v4`
- `care_case_verifications_v4`

The public API surface contains only:

- narrow `security_invoker` read views;
- `security_invoker` RPC facades;
- explicitly granted execute privileges.

Privileged implementations stay in `private` with `SECURITY DEFINER` and
explicit authorization checks.

## Privacy boundary

V4_014B does not introduce a patient/customer master table.

A signal may be registered only as:

- `SYNTHETIC`
- `DEIDENTIFIED`
- `AGGREGATE`

The canonical signal contract contains an opaque `source_ref`, not direct
customer/patient identifiers. Free-form customer name, phone, email, address or
date-of-birth fields are not part of the schema.

Human inputs used by the state machine are coded values rather than free-form
notes:

- decision reason code;
- action code;
- optional opaque action reference;
- outcome code;
- evidence type;
- opaque evidence reference.

## Semantic invariants

### Pending

A pending case:

- has no human decision;
- has no Owner;
- has no SLA;
- has no action;
- has no verification;
- has no close timestamp.

### Reject

`REJECT` means the human decided **not** to create the proposed care task.

A rejected case must:

- retain an explicit human decision and reason code;
- enter terminal state `REJECTED`;
- have no Owner;
- have no SLA;
- have no action timestamp;
- have no verification;
- have no artificial close evidence.

The decision itself remains auditable.

### Accept

`ACCEPT` creates accountable work.

The database requires:

- decision reason;
- deciding authenticated user and active membership;
- active Owner membership in the same organization;
- future due time/SLA.

The case enters `ACCEPTED`.

### Action

An action can be recorded only for an accepted case.

The first action changes the state to `IN_PROGRESS`. Additional action events
may be appended without rewriting the first-action timestamp.

### Verification before close

A case cannot be closed unless:

1. the human accepted it;
2. at least one action has been recorded;
3. a verification evidence record is created.

Verification and close occur atomically through the controlled RPC. The table
constraint independently enforces:

`first_action_at <= verified_at <= closed_at`.

## Evidence model

Policy versions, signals, events and verification records are append-only.
Update/delete attempts are rejected by trigger.

Care-case state changes are performed only by controlled RPCs. Direct DML is
revoked from `authenticated` and `service_role`.

Every human state mutation appends:

- care event evidence; and
- an organization-wide `audit_logs` entry.

## Authorization model

### Read

Read access uses the existing scoped permission:

`workflow.view`

RLS delegates to:

`private.has_scoped_permission_v4(organization_id, permission, warehouse_id, org_unit_id)`

### Human mutation

Human mutation requires the pre-existing commercial permission:

`workflow.manage`

V4_014B **does not create this permission**.

The migration fails closed if the permission does not already exist. If the
commercial RBAC catalog lacks `workflow.manage`, permission governance must be
resolved in a separate approved increment before V4_014B can be activated.

### Backend ingestion

Policy and signal/case registration RPCs are executable by `service_role`
only. No service-role credential is added to browser, Pages Functions or
frontend source.

## Public read models

### `care_queue_v4`

Safe queue projection for the future commercial gateway:

- organization
- case ID
- explicit care source
- warehouse/org-unit scope
- synthetic title derived from signal type
- priority
- state
- human decision
- Owner assignment presence
- due time
- reason code
- recommended action
- policy code/version

No direct identifier fields are added.

### `care_case_timeline_v4`

Append-only event timeline with event type, actor membership, structured payload
and timestamp. Underlying RLS remains authoritative.

## Activation prerequisites

Do not apply V4_014B until all of the following are true:

1. V4_014A review is accepted.
2. The exact commercial Supabase schema is available for fresh preflight.
3. `workflow.view` and `workflow.manage` are verified in the permission
   catalog and mapped to the intended roles/scopes.
4. `private` remains outside Data API exposed schemas.
5. A recoverable database backup exists and has been verified.
6. A non-production or controlled validation environment can execute migration
   acceptance tests first.
7. No identifiable patient/customer data is loaded.
8. Supabase security advisors are run after DDL activation.
9. Negative cross-tenant and insufficient-role tests pass.
10. V4 inventory/readiness invariants remain unchanged.

## Current claim boundary

Static CI can prove that the migration package encodes the intended state
machine and privilege boundary.

Static CI **cannot** prove:

- that the paused commercial database already contains `workflow.manage`;
- that the migration has been applied;
- that RLS behaves correctly against current live role assignments;
- that real pharmacy operators can complete the write workflow;
- production readiness;
- clinical or economic effectiveness.

Until controlled database execution occurs, V4_014B remains **SOURCE READY /
RUNTIME UNVERIFIED**.

## Next increment after source acceptance

V4_014C should execute this package in an isolated/controlled database and prove:

- migration preflight;
- service-only ingestion;
- positive ACCEPT path;
- negative REJECT-with-owner/SLA path;
- action-before-verification invariant;
- verification-before-close;
- scoped role and cross-tenant denial;
- append-only evidence;
- RLS read parity with V4_014A;
- zero inventory/readiness drift.

Only after V4_014C database acceptance should the commercial UI add controlled
human mutation controls.
