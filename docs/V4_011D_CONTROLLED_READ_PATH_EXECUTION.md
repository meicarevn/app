# V4_011D — Controlled Shadow Read-Path Promotion Execution

Status: **FOUNDER A APPROVED / CONTROLLED EXECUTION**

Tracking: #33

Preparation gate: #29 / PR #30

## Founder A approval

Founder A explicitly approved V4_011D Controlled Read-Path Promotion on 2026-09-06 (Asia/Ho_Chi_Minh):

> Tôi là Founder A và phê duyệt V4_011D Controlled Read-Path Promotion theo phạm vi PR #30.

Durable approval evidence is also retained in `docs/V4_011D_EXECUTION_APPROVAL_EVIDENCE.md` on the parent gate branch.

## Execution scope

This execution changes only the normal V4_011 **Shadow** read endpoint:

`GET /v4/shadow/intelligence-v4-011`

Semantic primary source changes from:

`inventory_intelligence_v4 + Cloudflare projectMultiAxisRows`

to:

`public.inventory_intelligence_multi_axis_v4_011`

The endpoint keeps the existing Shadow UI response shape and enriches DB-projection rows with read-only drug and warehouse display metadata using the same human JWT and underlying RLS.

## Preserved controls

- human Supabase JWT only;
- `inventory.view` permission required;
- ORGANIZATION scope required for the organization-wide endpoint;
- Supabase RLS remains final authority;
- public/publishable key only;
- GET only;
- no service-role credential;
- no mutation RPC/fetch;
- no inventory writes;
- no alert publication change;
- no runtime/readiness mutation;
- Founder B-approved A1/B1 semantics unchanged;
- expected-wastage suppression remains sourced from the additive DB projection.

## First promotion target

The first deployment target is the existing isolated V4_011 Shadow alias:

`https://v4-011-multi-axis-preview.meicare-smart-pharmacy.pages.dev`

This is **not** a global production frontend cutover. The root production Pages site is not replaced by this execution. `frontend_v4_ready` remains false.

## Automated acceptance

The execution workflow must:

1. run typecheck and all unit tests;
2. assert the normal V4_011 route contains `inventory_intelligence_multi_axis_v4_011` and no `projectMultiAxisRows(` call;
3. assert no service-role marker or mutation method is present;
4. assemble the existing Shadow Pages application;
5. deploy only to branch alias `v4-011-multi-axis-preview`;
6. verify `/multi-axis-review` returns HTTP 200;
7. verify unauthenticated V4_011 GET returns HTTP 401;
8. verify POST to V4_011 returns HTTP 405;
9. leave authenticated semantic acceptance to a human session because CI never stores user passwords/JWTs.

## Rollback

Rollback is route-only and does not require a database migration:

1. restore `shadow-pages/functions/v4/shadow/intelligence-v4-011.ts` from the parent pre-promotion revision;
2. redeploy that previous revision to the same V4_011 Shadow alias;
3. verify unauthenticated GET=401 and POST=405;
4. re-run read-only database parity/ledger-drift checks;
5. record reason, timestamp and evidence in #33.

The additive V4_011B database projection remains in place because it is independently accepted and non-destructive.

## Post-deploy production invariant

After deployment, re-check production database/runtime read-only. Required invariant:

- projection rows remain 2,244 at this accepted boundary;
- ledger drift remains 0;
- `cutover_stage=SHADOW`;
- `inventory_write_mode=LEGACY`;
- `alert_publish_mode=SHADOW`;
- `his_ingestion_mode=HYBRID`;
- `frontend_v4_ready=false`;
- integration/R2/IoT/AI readiness flags remain false.
