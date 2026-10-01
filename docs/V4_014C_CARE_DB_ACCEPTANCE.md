# MEICARE V4_014C — Ephemeral PostgreSQL Care DB Acceptance

Status: **PASS — SYNTHETIC DATABASE ACCEPTANCE / COMMERCIAL SUPABASE UNTOUCHED**

Parent: V4_014B Commercial Care State Machine.

## Purpose

Execute the V4_014B migration and state transitions against a real PostgreSQL 17
database before any commercial Supabase activation.

This acceptance uses an ephemeral GitHub Actions service container. No Supabase
or Cloudflare credential is present in the job.

## Environment

- PostgreSQL service image: `postgres:17-alpine`
- Observed server in CI: PostgreSQL 17.11
- Client: PostgreSQL 16.15
- Database exists only for the CI job and is destroyed at job completion.
- Commercial Supabase project: not restored, not queried, not mutated.
- Cloudflare: not deployed or mutated.

## Executed sequence

1. Bootstrap a minimal synthetic commercial contract:
   - organizations;
   - org units;
   - warehouses;
   - active memberships;
   - permission catalog;
   - audit log;
   - a scoped-permission helper compatible with the V4 contract.
2. Model Supabase `service_role` with `BYPASSRLS`.
3. Apply the unchanged V4_014B migration.
4. Execute 22 positive/negative state-machine and authorization checks.
5. Audit created schemas/views/function security.
6. Verify no external runtime credential is present.

## Acceptance result

**22 PASS / 0 FAIL / 22 TOTAL**

The executed checks cover:

- service-only policy/case ingestion;
- rejection of `IDENTIFIABLE` signal classification;
- service-vs-human RPC ACL separation;
- Org A positive RLS visibility;
- Org A → Org B read isolation;
- ACCEPT requires Owner/SLA;
- verification-before-action is blocked;
- ACCEPT → action → verification → close;
- five-event evidence timeline;
- REJECT preserves a decision without task/action/verification;
- action after REJECT is blocked;
- REJECT with Owner/SLA is blocked;
- read-only staff can read;
- read-only staff cannot mutate;
- Org B positive RLS visibility;
- Org B → Org A read isolation;
- cross-tenant mutation is blocked;
- direct care-table DML is revoked;
- public care RPCs are not `SECURITY DEFINER`;
- append-only event tampering is blocked;
- audit trace is written;
- failed unauthorized/invalid attempts leave a pending case unchanged.

## Schema audit result

Observed after acceptance:

```json
{
  "audit_rows": 4,
  "private_tables": 5,
  "public_care_views": 2,
  "public_security_definers": 0
}
```

## CI evidence

Final verified head:

`e9ec3bd0459684b2ff66f5113d047064fa26ed8a`

GitHub Actions run:

`36901077080`

All workflow steps completed successfully:

- source regression;
- PostgreSQL service startup;
- synthetic commercial bootstrap;
- V4_014B migration execution;
- 22-case acceptance;
- schema audit;
- production-isolation guard;
- container teardown.

Inherited source regression:

- 21 test files PASS;
- 118/118 tests PASS;
- High/Critical npm audit gate PASS;
- 2 Moderate Vitest advisories remain inherited and outside this increment.

## Findings from failed harness runs

Two earlier CI runs were retained as engineering evidence.

### Run 1 — fixture fidelity

The state machine executed, but `service_role` was initially modeled as an
ordinary PostgreSQL role. Supabase service role semantics include RLS bypass, so
a service-role count was hidden by RLS.

Fix:

- fixture only;
- model `service_role` with `BYPASSRLS`;
- no product migration or assertion changed.

### Run 2 — output parser

The acceptance itself returned `22 PASS / 0 FAIL`, but a shell grep expected
a different whitespace format around the JSON colon.

Fix:

- CI parser only;
- changed to whitespace-tolerant regex;
- no migration or acceptance assertion changed.

The final run then completed the schema audit and isolation guard.

## Claim boundary

V4_014C demonstrates that the V4_014B migration and its tested state machine
execute correctly in the recorded synthetic PostgreSQL 17 environment.

It does **not** prove:

- compatibility with the currently paused commercial Supabase schema;
- that `workflow.manage` exists or is correctly assigned in commercial RBAC;
- PostgREST/runtime parity in the commercial project;
- production readiness;
- operator usability;
- business, economic or clinical effectiveness.

## Next gate

Before applying to commercial Supabase:

1. obtain a fresh commercial schema/RBAC preflight after the project is
   intentionally available;
2. confirm `workflow.manage` exists and intended roles/scopes are mapped;
3. confirm `private` remains outside Data API exposed schemas;
4. verify backup/recovery;
5. run migration on an isolated Supabase branch or controlled non-production
   environment if one is authorized;
6. run Supabase security/performance advisors;
7. repeat authenticated positive/negative and cross-tenant tests;
8. only then consider commercial activation.

Until then, the database package is **SYNTHETIC-DB-VERIFIED / COMMERCIAL-RUNTIME-UNVERIFIED**.
