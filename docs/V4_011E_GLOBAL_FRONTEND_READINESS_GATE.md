# V4_011E — Global Frontend Readiness Promotion Gate

Status: **PREPARATION PASS / GLOBAL PROMOTION BLOCKED**

Tracking: #35

Parent accepted boundary: V4_011D / #33 / PR #34

## Purpose

V4_011E defines the fail-closed conditions that must be satisfied before a separate controlled execution may affect the global production Pages route or set `frontend_v4_ready=true`.

This preparation phase does **not** deploy to the global production frontend, does not mutate Supabase runtime/readiness, does not change inventory writes or alert publication, and does not modify IAM, secrets, permissions or RLS.

## Accepted baseline entering V4_011E

The authenticated V4_011D Shadow read-path acceptance is PASS. The accepted DB-backed multi-axis model remains:

- inventory keys: 2,244;
- A1: 284 = 39 `TRANSFER_REVIEW` + 245 `PROCUREMENT_REVIEW`;
- B1: 19 = 3 `CRITICAL` + 4 `HIGH` + 12 `WARNING`;
- semantic primary source: `public.inventory_intelligence_multi_axis_v4_011`;
- human JWT + `inventory.view` + ORGANIZATION scope + Supabase RLS preserved.

Read-only production verification at V4_011E preparation start confirms:

- projection rows = 2,244;
- ledger drift rows = 0;
- `cutover_stage=SHADOW`;
- `inventory_write_mode=LEGACY`;
- `alert_publish_mode=SHADOW`;
- `his_ingestion_mode=HYBRID`;
- `frontend_v4_ready=false`;
- integration/R2/IoT/AI readiness flags remain false.

## Current production-gate evidence

The latest recorded `V4_PRIMARY` production gate remains failed:

- `passed=false`;
- blocking failure count = 4;
- warning count = 4;
- V4 RLS check = PASS;
- inventory ledger drift check = PASS;
- V4 public SECURITY DEFINER exposure = 0 / PASS;
- legacy public authenticated SECURITY DEFINER exposure = 13 / FAIL and marked blocking for primary;
- backup/restore verified = false;
- `frontend_v4_ready=false`;
- integration/R2/IoT/AI readiness flags remain false.

The latest recorded `CANARY` production gate passed with zero blocking failures while retaining warnings. Therefore V4_011E does not reinterpret the failed V4_PRIMARY gate as a blanket frontend blocker; it surfaces its relevant unresolved items explicitly below.

## Current Supabase advisor evidence

Security Advisor currently reports:

1. 13 legacy `public` SECURITY DEFINER functions executable by `authenticated`;
2. leaked-password protection disabled.

These are existing production security debts. V4_011E does not change them. Before any global frontend promotion, they must either be remediated or receive explicit scoped Founder A risk acceptance with durable evidence. This risk acceptance is distinct from the separate Founder A approval required to execute the global frontend promotion.

Performance Advisor also reports existing informational/warning debt including unindexed foreign keys, unused indexes and multiple permissive RLS policies. V4_011E records these as technical debt but does not make informational performance lints a global frontend blocker unless a measured regression is found in the controlled execution evidence.

Remediation references:

- SECURITY DEFINER exposure: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- Leaked Password Protection: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- Unindexed Foreign Keys: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
- Unused Indexes: https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index
- Multiple Permissive Policies: https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies

## Gate evaluator

`src/v4-011e-frontend-readiness-gate.ts` is a pure fail-closed evaluator. It never deploys or mutates production.

Mandatory controls include:

- V4_011D authenticated acceptance PASS;
- exact accepted projection row boundary (2,244 at this evidence point);
- ledger drift = 0;
- semantic regression rows = 0;
- unsafe recommendation rows = 0;
- auth contract PASS;
- RLS contract PASS;
- no service-role exposure;
- global production route unchanged during preparation;
- route rollback evidence present;
- backup/restore verified with durable evidence;
- security debt remediated **or** explicit scoped Founder A risk acceptance with evidence;
- `cutover_stage=SHADOW`;
- inventory writes remain `LEGACY`;
- alerts remain `SHADOW`;
- HIS ingestion remains `HYBRID`;
- `frontend_v4_ready=false` before execution;
- explicit Founder A global-promotion approval with durable evidence.

A `READY_FOR_SEPARATE_CONTROLLED_GLOBAL_FRONTEND_PROMOTION` result is not itself authorization to deploy. The evaluator always returns `global_production_mutation_authorized=false`; execution must be a separate governed step.

## Current gate result

Using the current production evidence, V4_011E is intentionally **BLOCKED** by at least:

- `BACKUP_RESTORE_EVIDENCE_REQUIRED`;
- `SECURITY_DEBT_REMEDIATION_OR_RISK_ACCEPTANCE_REQUIRED`;
- `FOUNDER_A_APPROVAL_REQUIRED`.

The evaluator also surfaces:

- `V4_PRIMARY_GATE_STILL_FAILED`;
- `V4_PRIMARY_GATE_HAS_BLOCKING_FAILURES`.

This is the expected state. Preparation can complete while global promotion remains fail-closed.

## Rollback design for the later controlled execution

Before a global deployment is attempted, the execution issue/PR must capture the exact current production deployment identifier/commit and verify it is redeployable. The controlled execution must then:

1. deploy the candidate with an explicit production target only after Founder A approval and all gate conditions;
2. run unauthenticated and authenticated smoke tests immediately;
3. verify A1/B1 semantics, 2,244-key boundary (or an explicitly reconciled newer truth boundary), RLS/auth contract and ledger drift;
4. if any invariant fails, redeploy the captured prior production deployment/commit;
5. re-run the same smoke/invariant checks after rollback;
6. record timestamp, cause and evidence in the execution issue.

No database rollback is required for frontend-route rollback because the independently accepted additive V4_011B projection remains non-destructive.

## Preparation CI boundary

`.github/workflows/v4-011e-frontend-readiness-gate.yml`:

- runs typecheck and all unit tests;
- runs the dedicated V4_011E tests;
- verifies the preparation diff is restricted to the V4_011E evaluator/test/doc/workflow files;
- rejects Supabase migrations, Cloudflare deploy commands, production Pages branch markers, service-role markers and readiness mutations;
- contains no deployment step and no production credential requirement.

## Governance boundary

This gate does not authorize:

- global production Pages deployment;
- `frontend_v4_ready=true`;
- inventory-write cutover;
- alert-publication cutover;
- IAM/secret/permission/RLS changes;
- any change to pharmacy safety semantics.

A later global execution requires explicit Founder A approval. If that execution changes pharmacy prioritization, alert meaning, medication interpretation or safety semantics, Founder B approval is also required under the repository release gate.
