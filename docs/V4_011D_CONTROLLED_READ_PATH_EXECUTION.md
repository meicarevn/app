# V4_011D — Controlled Shadow Read-Path Promotion Execution

Status: **FOUNDER A APPROVED / AUTOMATED EXECUTION PASS / AUTHENTICATED HUMAN ACCEPTANCE PENDING**

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

## Automated acceptance — PASS

Current execution head: `3b9fa41ffd8a038a2fe4a5e29f98cd81953f810f`.

GitHub Actions evidence:

- V4_011D Controlled Shadow Read-Path Promotion run `34030185500`: SUCCESS;
- V4 Gateway CI run `34030187765`: SUCCESS;
- 12 test files / 68 tests: PASS;
- TypeScript typecheck: PASS;
- browser JavaScript syntax: PASS;
- execution safety guards: PASS.

Cloudflare deployment:

- immutable deployment: `https://e4e12b64.meicare-smart-pharmacy.pages.dev`;
- controlled alias: `https://v4-011-multi-axis-preview.meicare-smart-pharmacy.pages.dev`;
- global production frontend was explicitly not targeted.

Live smoke passed:

- `/multi-axis-review` HTTP 200;
- unauthenticated promoted endpoint HTTP 401;
- POST promoted endpoint HTTP 405;
- `X-Meicare-Read-Path: V4_011D_DB_PROJECTION` propagated on promoted route responses.

## Post-deploy production invariant — PASS

Read-only production verification after deployment confirms:

- projection rows = 2,244;
- ledger drift rows = 0;
- `cutover_stage=SHADOW`;
- `inventory_write_mode=LEGACY`;
- `alert_publish_mode=SHADOW`;
- `his_ingestion_mode=HYBRID`;
- `frontend_v4_ready=false`;
- `integration_layer_ready=false`;
- `r2_gateway_ready=false`;
- `iot_gateway_ready=false`;
- `ai_orchestrator_ready=false`.

## Rollback

Rollback is route-only and does not require a database migration:

1. restore `shadow-pages/functions/v4/shadow/intelligence-v4-011.ts` from the parent pre-promotion revision;
2. redeploy that previous revision to the same V4_011 Shadow alias;
3. verify unauthenticated GET=401 and POST=405;
4. re-run read-only database parity/ledger-drift checks;
5. record reason, timestamp and evidence in #33.

The additive V4_011B database projection remains in place because it is independently accepted and non-destructive.

## Remaining gate

Authenticated human acceptance is still required. CI intentionally does not possess a user's password/JWT.

The human acceptance should confirm that the normal V4_011 Shadow page still renders the accepted 2,244-key model, A1/B1 cohorts and drug/warehouse metadata without regression. PR #34 remains Draft/Open/Unmerged until that acceptance is recorded.
