# V4_011D — Controlled Read-Path Execution Evidence

Status: **FOUNDER A APPROVED / ISOLATED SHADOW PROMOTION IN PROGRESS / AUTHENTICATED ACCEPTANCE PENDING**

Tracking: #48

## Approved scope

Founder A approved V4_011D Controlled Read-Path Promotion according to PR #30. This execution changes only the normal V4_011 Shadow endpoint on the existing isolated V4_011 Pages alias.

The semantic primary source becomes:

`public.inventory_intelligence_multi_axis_v4_011`

The execution preserves:
- human JWT authentication;
- `inventory.view` authorization;
- ORGANIZATION scope requirement;
- Supabase RLS as final authority;
- publishable key only;
- GET-only behavior;
- no service-role credential;
- no inventory write;
- no alert publication change;
- no readiness promotion;
- Founder B-approved A1/B1 semantics;
- current Shadow response contract and drug/warehouse display metadata.

Display metadata is read separately from `inventory_intelligence_v4`; no semantic state is projected from that metadata path. `projectMultiAxisRows` is removed from the promoted normal endpoint.

## Deployment target

Only:

`https://v4-011-multi-axis-preview.meicare-smart-pharmacy.pages.dev`

Global production frontend routing remains unchanged and `frontend_v4_ready` remains false.

## Pre-deployment production invariant

Required:
- DB projection rows = 2,244;
- ledger drift = 0;
- cutover stage = SHADOW;
- inventory write mode = LEGACY;
- alert publish mode = SHADOW;
- HIS ingestion mode = HYBRID;
- frontend/integration/R2/IoT/AI readiness flags remain false.

## Automated execution acceptance

Required CI checks:
- typecheck and unit tests pass;
- normal route contains `inventory_intelligence_multi_axis_v4_011`;
- normal route does not contain `projectMultiAxisRows`;
- no service credential marker;
- no mutation fetch;
- no Supabase migration;
- isolated Pages deployment succeeds;
- page HTTP 200;
- unauthenticated endpoint HTTP 401;
- POST endpoint HTTP 405.

## Human acceptance

After deployment, authenticate on the isolated V4_011 alias and confirm:
- 2,244 projected rows;
- A1 = 284 = 39 transfer + 245 procurement;
- B1 = 19 = 3 critical + 4 high + 12 warning;
- drug and warehouse labels are present;
- filters/pagination continue to work;
- no automatic recommendation execution is introduced.

## Rollback

If any invariant fails, restore the prior normal V4_011 Shadow endpoint implementation that reads `inventory_intelligence_v4` and runs `projectMultiAxisRows`, then redeploy the previous known-good isolated alias revision. No DB rollback is required because V4_011B remains additive.
