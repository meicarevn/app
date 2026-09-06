# V4_011D — Controlled Read-Path Promotion Gate

Status: **FOUNDER A APPROVED / PREPARATION GATE PASS / EXECUTION MOVED TO SEPARATE CONTROLLED PR**

Tracking: #29

## Purpose

Prepare the release gate for promoting the normal V4_011 Shadow read path from the Cloudflare/TypeScript projection to the additive production database projection `public.inventory_intelligence_multi_axis_v4_011`.

This preparation step does **not** itself change the normal application route. It converts the accepted V4_011C canary evidence into an explicit fail-closed production-promotion decision model.

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

## Governance approval

Founder A explicitly approved V4_011D Controlled Read-Path Promotion in ChatGPT on 2026-09-06 (Asia/Ho_Chi_Minh), with the instruction:

> Tôi là Founder A và phê duyệt V4_011D Controlled Read-Path Promotion theo phạm vi PR #30.

This satisfies the Founder A technology/security approval gate for the scoped read-path promotion. The approval does **not** authorize unrelated production routing, readiness promotion, alert publication, inventory-write cutover, IAM/secrets/RLS changes, or clinical-semantic changes.

## Governance boundary

`.github/MEICARE_RELEASE_GATE.md` requires Founder A approval before a material production infrastructure/security change. V4_011D separates:

1. **technical readiness** — parity, drift, runtime and safety evidence;
2. **governance approval** — explicit Founder A approval with durable evidence;
3. **execution** — a separately reviewed controlled promotion action.

The evaluator in `src/v4-011d-promotion-gate.ts` remains fail-closed and always returns `production_mutation_authorized=false`; this preparation PR does not deploy by itself.

## Approved production change scope

The separately reviewed execution PR may change only the normal V4_011 **Shadow** read endpoint so its semantic primary source is `public.inventory_intelligence_multi_axis_v4_011`.

The execution must preserve:

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
- no clinical-semantic changes to the Founder B-approved A1/B1 model;
- the current Shadow UI response contract, including drug/warehouse display metadata.

The first promotion target is the existing isolated V4_011 Shadow alias, not the global production frontend. `frontend_v4_ready` remains false.

## Rollback plan

The first promotion is reversible without database mutation.

Rollback target:

1. restore the previous normal V4_011 Shadow read implementation that reads `inventory_intelligence_v4` and runs `projectMultiAxisRows` in Cloudflare;
2. redeploy the previous known-good V4_011 Shadow alias revision;
3. keep `cutover_stage=SHADOW`, `inventory_write_mode=LEGACY`, and `alert_publish_mode=SHADOW` unchanged;
4. run the same read-only parity and ledger-drift checks after rollback;
5. record rollback timestamp, reason, and evidence in the release issue/PR.

No database migration is required for this read-path rollback because V4_011B is additive and the legacy read source remains intact.

## Preparation acceptance

V4_011D preparation is accepted because:

- authenticated V4_011C acceptance is PASS;
- unit tests prove Founder A approval is mandatory;
- parity/drift/runtime regression cases fail closed;
- CI confirms the normal Shadow route was not modified in the preparation PR;
- no service-role or mutation marker is introduced;
- promotion and rollback plans are documented;
- Founder A approval is now durably recorded.

## Current decision

**READY FOR SEPARATE CONTROLLED EXECUTION**

The preparation PR itself remains non-deploying. Execution evidence belongs in the dedicated execution issue/PR.
