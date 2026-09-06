# V4_011D — Controlled Read-Path Promotion Gate

Status: **PREPARATION / REVIEW ONLY / PRODUCTION PROMOTION BLOCKED PENDING FOUNDER A**

Tracking: #29

## Purpose

Prepare the release gate for promoting the normal V4_011 Shadow read path from the Cloudflare/TypeScript projection to the additive production database projection `public.inventory_intelligence_multi_axis_v4_011`.

This preparation step does **not** change the normal application route. It converts the accepted V4_011C canary evidence into an explicit fail-closed production-promotion decision model.

## Evidence entering V4_011D

The gate starts from the accepted V4_011C state:

- authenticated human canary acceptance = PASS;
- exact DB ↔ Cloudflare semantic parity accepted;
- parity mismatch rows = 0;
- missing DB rows = 0;
- missing Cloudflare rows = 0;
- unsafe recommendations = 0;
- additive projection rows = 2,244;
- inventory ledger drift rows = 0;
- `cutover_stage = SHADOW`;
- `inventory_write_mode = LEGACY`;
- `alert_publish_mode = SHADOW`;
- `his_ingestion_mode = HYBRID`;
- `frontend_v4_ready = false`;
- integration/R2/IoT/AI readiness flags remain false.

## Governance boundary

`.github/MEICARE_RELEASE_GATE.md` requires Founder A approval before a material production infrastructure/security change. A production application read-path/routing promotion is therefore not authorized by test success alone.

V4_011D intentionally separates:

1. **technical readiness** — parity, drift, runtime and safety evidence;
2. **governance approval** — explicit Founder A approval with durable evidence;
3. **execution** — a later separately reviewed production promotion action.

The evaluator in `src/v4-011d-promotion-gate.ts` is fail-closed. It always returns `production_mutation_authorized=false`; even a `READY_FOR_CONTROLLED_PROMOTION` decision is evidence for a later execution step, not permission for AI to deploy autonomously.

## Gate blockers

Promotion is blocked when any of the following is true:

- authenticated V4_011C acceptance is absent;
- exact parity is false;
- parity mismatch rows, missing-path rows, or unsafe recommendations are non-zero;
- projection row count is outside the accepted 2,244-key baseline at this controlled boundary;
- inventory ledger drift is non-zero;
- runtime has moved away from `SHADOW / LEGACY / SHADOW / HYBRID` before this gate;
- `frontend_v4_ready` was changed before the gate;
- Founder A approval is absent;
- Founder A approval is asserted but durable approval evidence is missing.

The row-count check is intentionally strict for this controlled gate. If legitimate inventory scope changes before promotion, the baseline must be re-established through a fresh read-only parity acceptance rather than silently bypassing the blocker.

## Proposed production change after approval

Only after Founder A approval is explicitly recorded should a separate execution PR be allowed to change the normal V4_011 Shadow read path so its primary source is `public.inventory_intelligence_multi_axis_v4_011`.

The execution PR must preserve:

- original human JWT authentication;
- existing `inventory.view` authorization;
- ORGANIZATION-scope requirement for organization-wide reads;
- Supabase RLS as final authority;
- public/publishable key only in browser/edge code;
- GET-only behavior;
- no service-role credential;
- no inventory writes;
- no alert publication change;
- no readiness flag promotion as a side effect;
- no clinical-semantic changes to the Founder B-approved A1/B1 model.

## Rollback plan

The first production promotion must be reversible without database mutation.

Rollback target:

1. restore the previous normal V4_011 Shadow read implementation that reads `inventory_intelligence_v4` and runs `projectMultiAxisRows` in Cloudflare;
2. redeploy the previous known-good Cloudflare Pages/Functions revision;
3. keep `cutover_stage=SHADOW`, `inventory_write_mode=LEGACY`, and `alert_publish_mode=SHADOW` unchanged;
4. run the same read-only parity and ledger-drift checks after rollback;
5. record rollback timestamp, reason, and evidence in the release issue/PR.

No database migration is required for this read-path rollback because V4_011B is additive and the legacy read source remains intact.

## Preparation acceptance

This V4_011D preparation PR is accepted when:

- unit tests prove Founder A approval is mandatory;
- parity/drift/runtime regression cases fail closed;
- CI confirms the normal production read route was not modified in the preparation PR;
- no service-role or mutation marker is introduced;
- promotion and rollback plans are documented;
- PR remains Draft/Open/Unmerged pending Founder A decision.

## Current decision

**BLOCKED — FOUNDER_A_APPROVAL_REQUIRED**

No production route, runtime flag, readiness flag, alert mode, inventory-write mode, IAM, secret, permission, or RLS change is authorized by this document.