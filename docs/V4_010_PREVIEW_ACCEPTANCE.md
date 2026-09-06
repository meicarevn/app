# V4_010 — Full Shadow Frontend Preview Acceptance

Status: **ISOLATED PREVIEW DEPLOYED / AUTOMATED READ-ONLY SMOKE PASS / AUTHENTICATED UX ACCEPTANCE PENDING**

Issue: #19

## Boundary

The V4_010 preview is deployed only to a Cloudflare Pages branch alias. It does not replace the normal MEICARE production UI and it must not change `frontend_v4_ready`.

Stable preview URL:

`https://v4-010-shadow-preview.meicare-smart-pharmacy.pages.dev`

The preview uses:

- normal Supabase Auth credentials entered by the human user;
- a public Supabase publishable key in browser code;
- the human access token for read requests;
- same-origin Cloudflare Pages Functions for the V4 Shadow API;
- Supabase RLS as the final data-access authority.

The preview does not use or expose a Supabase service-role key.

## Deployment and automated evidence

GitHub Actions run **34014115632** completed successfully on commit `d94b59db4c29686f00e8f4118d7be116bf65269a`.

Deployment evidence:

- existing Pages project: `meicare-smart-pharmacy`;
- branch alias: `v4-010-shadow-preview`;
- stable preview: `https://v4-010-shadow-preview.meicare-smart-pharmacy.pages.dev`;
- observed deployment URL: `https://7e919314.meicare-smart-pharmacy.pages.dev`;
- Worker/Pages Functions bundle compiled and deployed successfully;
- repository TypeScript check = PASS;
- unit tests = **37 / 37 PASS**;
- preview JavaScript syntax = PASS;
- service-role/secret static guard = PASS.

Live preview smoke passed on the first check for every route:

- root = HTTP **200** with `SHADOW · READ ONLY` marker;
- canonical `/login` = HTTP **200** with V4_010 marker;
- unauthenticated `/v4/shadow/session` = **401 UNAUTHORIZED**;
- unauthenticated `/v4/shadow/overview` = **401 UNAUTHORIZED**;
- POST `/v4/shadow/overview` = **405 METHOD_NOT_ALLOWED** before authentication.

The existing **V4 Shadow Read CI** run **34014116775** on the same head also completed successfully.

## Read-only controls

The Pages adapter rejects every non-GET request before authentication or PostgREST access. The adapter also applies permission gates before delegating to the V4 read handler:

| View | Required permission | Extra scope requirement |
|---|---|---|
| Tổng quan | inventory.view | — |
| Kho thông minh | inventory.view | — |
| Action Center | workflow.view | — |
| Đối soát HIS | reconciliation.view | — |
| IoT / GSP | iot.view | — |
| Tài liệu & Evidence | document.view | — |
| So sánh V3 ↔ V4 | inventory.view | ORGANIZATION |
| Production Gate | organization.view | ORGANIZATION |
| Thành viên link | membership.manage | ORGANIZATION |

RLS remains authoritative after these UI/API gates.

## Device acceptance matrix

### Desktop / laptop

- fixed top navigation remains visible;
- sidebar remains usable without hiding data columns;
- inventory/action tables scroll horizontally when required;
- all eight read views render without mutation controls;
- role badge and current scope remain visible.

### Tablet / iPad

- at widths up to the tablet breakpoint, navigation changes to the existing fixed horizontal layout;
- no content is obscured by top navigation;
- touch targets remain suitable for touch interaction;
- large tables scroll independently rather than shrinking columns below readability.

### Mobile

- navigation remains reachable horizontally;
- cards collapse to a single-column layout;
- refresh and connection controls remain usable;
- no horizontal page overflow outside intentional table/navigation scroll regions.

## Authenticated session acceptance still required

1. Open the isolated preview.
2. Open `/login` and sign in with an existing Supabase account.
3. Verify redirect to the V4 Shadow UI.
4. Verify organization and role/scope are derived from the authenticated session.
5. Exercise only GET/read views appropriate to that role.
6. Check desktop/tablet/mobile layout as applicable.
7. Clear the preview session or close the tab after testing.

The password is not stored. The access token is stored only in the tab's `sessionStorage` for this isolated acceptance preview. This is not the final production authentication UX.

## Production invariant after deployment

Post-deployment database verification remains:

- `cutover_stage = SHADOW`
- `inventory_write_mode = LEGACY`
- `alert_publish_mode = SHADOW`
- `his_ingestion_mode = HYBRID`
- `integration_layer_ready = false`
- `frontend_v4_ready = false`
- `r2_gateway_ready = false`
- `iot_gateway_ready = false`
- `ai_orchestrator_ready = false`
- inventory ledger drift rows = **0**

## Promotion blockers

The preview is technically deployed and automated read-only smoke is complete, but `frontend_v4_ready` must remain false while any of the following remain unresolved:

- authenticated role/device UX acceptance is incomplete;
- Founder B semantic review for the 284 zero-stock/insufficient-evidence cases;
- Founder B review of the 19 expiry-priority cases;
- demand/forecast coverage remains absent;
- global frontend release approval has not been recorded;
- broader production-gate blockers remain open.
