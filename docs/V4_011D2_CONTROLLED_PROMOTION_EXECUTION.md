# V4_011D2 — Controlled DB-backed Shadow Read Promotion Execution

Tracking: #31

Status: **FOUNDER A APPROVED / CONTROLLED EXECUTION / NO GLOBAL FRONTEND CUTOVER**

## Purpose

Execute the read-path promotion prepared by V4_011D while keeping the system in SHADOW mode. The normal V4_011 Shadow endpoint now reads the additive production database projection `public.inventory_intelligence_multi_axis_v4_011` instead of recalculating the multi-axis projection in Cloudflare.

## Scope

The promoted route preserves:

- original human JWT authentication;
- `inventory.view` authorization;
- ORGANIZATION-scope requirement;
- Supabase RLS as final authority;
- public/publishable Supabase key only;
- GET-only behavior;
- no inventory mutation;
- no alert publication change;
- no runtime/readiness mutation;
- no A1/B1 clinical-semantic change.

The route enriches DB projection rows with read-only drug and warehouse labels under the same user JWT, then returns the same V4_011 UI contract including `approved_semantic_cohort` and summary metrics.

## Pre-execution gate evidence

Immediately before execution, read-only production verification returned:

- projection rows = 2,244;
- QOH = 4,953,566;
- A1 = 284 = 39 `TRANSFER_REVIEW` + 245 `PROCUREMENT_REVIEW`;
- B1 = 19 = 3 CRITICAL + 4 HIGH + 12 WARNING;
- unsafe recommendations = 0;
- inventory ledger drift = 0;
- runtime = SHADOW / LEGACY / SHADOW / HYBRID;
- `frontend_v4_ready=false`;
- integration/R2/IoT/AI readiness flags = false;
- missing drug references = 0;
- missing warehouse references = 0.

## Deployment boundary

The execution workflow deploys only to the existing Cloudflare Pages branch alias:

`v4-011-multi-axis-preview.meicare-smart-pharmacy.pages.dev`

It does **not** deploy to the production/main Pages branch and does not replace the global production frontend.

## Rollback

Known-good prior V4_011 Cloudflare-projection branch head:

`3606767ceb5b1c86d2422eb3a312b306848ff890`

Rollback is application-only:

1. redeploy the V4_011 preview from that known-good revision/branch to the `v4-011-multi-axis-preview` alias;
2. verify unauthenticated API = 401 and POST = 405;
3. run authenticated V4_011 acceptance;
4. re-run read-only projection row-count, A1/B1 and ledger-drift checks;
5. record timestamp/reason/evidence.

No database rollback is required because V4_011B remains additive and the old `inventory_intelligence_v4` read source remains intact.

## Acceptance

Execution is accepted when:

- typecheck and all tests pass;
- static guard confirms normal V4_011 route reads `inventory_intelligence_multi_axis_v4_011` and contains no `projectMultiAxisRows` call;
- no service-role marker or mutation method is introduced;
- no Supabase migration is introduced;
- isolated normal V4_011 preview deploy succeeds;
- page HTTP 200, unauthenticated API 401 and POST 405 smoke pass;
- authenticated human acceptance confirms 2,244 keys and the A1/B1 baseline;
- post-deploy production DB invariants remain unchanged.

PR stays Draft/Open/Unmerged until authenticated acceptance is recorded.
