# V4_010 — Full Shadow Frontend Preview Acceptance

Status: **ISOLATED PREVIEW / READ ONLY**

Issue: #19

## Boundary

The V4_010 preview is deployed only to a Cloudflare Pages branch alias. It does not replace the normal MEICARE production UI and it must not change `frontend_v4_ready`.

The preview uses:

- normal Supabase Auth credentials entered by the human user;
- a public Supabase publishable key in browser code;
- the human access token for read requests;
- same-origin Cloudflare Pages Functions for the V4 Shadow API;
- Supabase RLS as the final data-access authority.

The preview does not use or expose a Supabase service-role key.

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

## Session acceptance

1. Open the isolated preview.
2. Sign in through `login.html` with the existing Supabase account.
3. Verify redirect to the V4 Shadow UI.
4. Verify organization and role/scope are derived from the authenticated session.
5. Exercise only GET/read views.
6. Clear the preview session or close the tab after testing.

The password is not stored. The access token is stored only in the tab's `sessionStorage` for this isolated acceptance preview. This is not the final production authentication UX.

## Automated smoke expectations

- preview root returns 200;
- preview login page returns 200;
- unauthenticated GET `/v4/shadow/session` returns 401;
- unauthenticated GET `/v4/shadow/overview` returns 401;
- POST `/v4/shadow/overview` returns 405 before auth;
- browser/static source contains no service-role/secret-key marker;
- deployment uses an isolated branch alias;
- normal production Pages hostname is not overwritten.

## Promotion blockers

The preview may be considered technically observable after smoke/role/device acceptance, but `frontend_v4_ready` must remain false while any of the following remain unresolved:

- Founder B semantic review for the 284 zero-stock/insufficient-evidence cases;
- Founder B review of the 19 expiry-priority cases;
- demand/forecast coverage remains absent;
- global frontend release approval has not been recorded;
- broader production-gate blockers remain open.
