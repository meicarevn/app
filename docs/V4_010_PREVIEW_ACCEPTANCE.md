# V4_010 — Full Shadow Frontend Preview Acceptance

Status: **ISOLATED PREVIEW DEPLOYED / AUTOMATED READ-ONLY SMOKE PASS / AUTHENTICATED IPAD ACCEPTANCE PASS**

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

Latest visual-fix head before manual acceptance: `37525b2c3c4ceebde2211f53b081b7d9ffdfd3db`.

GitHub Actions evidence on this head:

- **V4_010 Full Shadow Pages Preview** run `34014905636` = SUCCESS;
- **V4 Shadow Read CI** run `34014907341` = SUCCESS;
- repository TypeScript check = PASS;
- unit tests = **37 / 37 PASS**;
- preview JavaScript syntax = PASS;
- service-role/secret static guard = PASS.

Latest deployment evidence:

- existing Pages project: `meicare-smart-pharmacy`;
- branch alias: `v4-010-shadow-preview`;
- stable preview: `https://v4-010-shadow-preview.meicare-smart-pharmacy.pages.dev`;
- observed deployment URL: `https://3d8ed05d.meicare-smart-pharmacy.pages.dev`;
- Worker/Pages Functions bundle compiled and deployed successfully.

Live preview smoke passed on the first check for every route:

- root = HTTP **200** with `SHADOW · READ ONLY` marker;
- canonical `/login` = HTTP **200** with V4_010 marker;
- unauthenticated `/v4/shadow/session` = **401 UNAUTHORIZED**;
- unauthenticated `/v4/shadow/overview` = **401 UNAUTHORIZED**;
- POST `/v4/shadow/overview` = **405 METHOD_NOT_ALLOWED** before authentication.

## Authenticated iPad acceptance

Authenticated screenshots supplied from iPad confirm that:

- Supabase login completes and redirects to the Shadow UI;
- current session resolves as `OWNER` with `ORGANIZATION` scope;
- effective permission count is visible (`32` in the captured session);
- Overview loads V4 operational metrics;
- V3 ↔ V4 comparison loads and shows `2,244` rows on both sides with quantity mismatch `0`;
- the green quantity-truth confirmation is visible and readable;
- semantic mismatch count `1,693` is visible with representative `DEFAULT_HEALTHY → HEALTHY`, `OUT_OF_STOCK → INSUFFICIENT_DATA`, and healthy/low-stock → `EXPIRY_RISK` samples;
- the previously false “Chưa cấu hình kết nối”, false scope warning, and empty red error bar are no longer present after refresh;
- dark-mode contrast is readable;
- the tablet top bar is compact enough to preserve role/session controls without wrapping;
- the horizontal navigation and large comparison table remain usable on iPad.

The manual iPad acceptance is therefore **PASS** for the current isolated Shadow preview.

Previously observed presentation defects were fixed before this acceptance:

1. elements carrying the HTML `hidden` attribute were still visible because `.notice { display:flex }` overrode the browser hidden rule;
2. the login card used system `Canvas` colors while the rest of the app used dark-mode variables, producing low contrast;
3. the tablet top bar was too crowded and allowed control labels to wrap.

Current fixes remain:

- global `[hidden] { display:none!important; }` in the Shadow role UX stylesheet;
- explicit dark/light login surface and text variables plus `color-scheme` metadata;
- improved dark-mode warning/error/success contrast;
- tablet header compaction, non-wrapping controls, hidden redundant Shadow badge/manual connection button at tablet widths;
- authenticated role/session chips and horizontal read-navigation preserved.

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

Desktop/laptop manual acceptance has not yet been separately recorded in V4_010.

### Tablet / iPad

**PASS** on authenticated Founder A / OWNER session:

- navigation uses the fixed horizontal layout;
- top-bar controls do not wrap or obscure content;
- hidden notices remain absent when the authenticated session is configured and organization-scoped;
- no content is obscured by navigation;
- touch targets remain suitable for touch interaction;
- large tables remain independently scrollable/readable.

### Mobile

- navigation remains reachable horizontally;
- cards collapse to a single-column layout;
- preview/session controls remain usable;
- no horizontal page overflow outside intentional table/navigation scroll regions.

Mobile manual acceptance has not yet been separately recorded in V4_010.

## Production invariant

The preview must not change:

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

The isolated preview and authenticated iPad acceptance are complete, but `frontend_v4_ready` must remain false while any of the following remain unresolved:

- Founder B semantic review for the 284 zero-stock/insufficient-evidence cases;
- Founder B review of the 19 expiry-priority cases;
- demand/forecast coverage remains absent;
- desktop/mobile acceptance is not yet separately evidenced;
- global frontend release approval has not been recorded;
- broader production-gate blockers remain open.
