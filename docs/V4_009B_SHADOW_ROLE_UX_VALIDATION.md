# V4_009B — Shadow UX & Role Validation

Status: **implemented on review branch; no production deployment; `frontend_v4_ready=false` remains required**.

## Objective

Validate the V4 Shadow read experience for the four initial hospital-pharmacy roles used for acceptance:

- OWNER
- PHARMACY_MANAGER
- PHARMACIST
- AUDITOR

The Shadow surface remains GET-only, uses the Supabase anon key plus the caller's original user JWT, and leaves RLS as the final data-access authority.

## RBAC evidence from current V4 database

The V4 global role mappings currently grant all four acceptance roles:

| Role | inventory.view | workflow.view | reconciliation.view | iot.view | document.view | document.sensitive_view |
|---|---:|---:|---:|---:|---:|---:|
| OWNER | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PHARMACY_MANAGER | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PHARMACIST | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| AUDITOR | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

The missing `document.sensitive_view` for PHARMACIST and AUDITOR is intentional. `document_registry_v4` RLS independently hides L4 health-data documents unless that permission is present.

## Shadow route permission contract

V4_009B adds a second, explicit API-level permission gate before the existing RLS-backed reads:

| Shadow route | Required V4 permission |
|---|---|
| `/v4/shadow/session` | active organization role; response only describes caller's own effective roles/permissions |
| `/v4/shadow/overview` | `inventory.view` |
| `/v4/shadow/inventory` | `inventory.view` |
| `/v4/shadow/actions` | `workflow.view` |
| `/v4/shadow/reconciliations` | `reconciliation.view` |
| `/v4/shadow/iot` | `iot.view` |
| `/v4/shadow/documents` | `document.view` |
| `/v4/shadow/readiness` | `organization.view` |
| `/v4/shadow/compare/inventory` | `inventory.view` |

Missing permission returns `403 SHADOW_PERMISSION_DENIED` before the domain read is attempted.

This API gate is defense-in-depth only. It does not replace Postgres RLS.

## Session endpoint

`GET /v4/shadow/session` derives the current session from:

1. Supabase Auth user resolved from the original bearer token;
2. `membership_effective_roles_v4`, filtered to the current user + organization + `is_current=true`;
3. `role_permissions` for those roles;
4. `permissions` for the resulting permission IDs.

The endpoint returns non-secret context only:

- user ID;
- organization ID;
- current role assignments;
- scope type / scope ID;
- permission codes;
- UI capabilities;
- `scope_warning` when any assignment is narrower than ORGANIZATION.

No service-role key is used by the Shadow Worker.

## Role acceptance matrix

All four initial acceptance roles are expected to see the following read-only screens under current global role mappings:

| Screen | OWNER | PHARMACY_MANAGER | PHARMACIST | AUDITOR | Notes |
|---|---:|---:|---:|---:|---|
| Tổng quan | ✅ | ✅ | ✅ | ✅ | requires `inventory.view` |
| Kho thông minh | ✅ | ✅ | ✅ | ✅ | requires `inventory.view` |
| Action Center | ✅ | ✅ | ✅ | ✅ | requires `workflow.view`; no execute controls |
| Đối soát HIS | ✅ | ✅ | ✅ | ✅ | requires `reconciliation.view`; no commit controls |
| IoT / GSP | ✅ | ✅ | ✅ | ✅ | requires `iot.view`; no quarantine controls |
| Tài liệu & Evidence | ✅ incl. L4 | ✅ incl. L4 | ✅ except L4 | ✅ except L4 | L4 still enforced by DB RLS |
| So sánh V3 ↔ V4 | ✅ | ✅ | ✅ | ✅ | requires `inventory.view` |
| Production Gate | ✅ | ✅ | ✅ | ✅ | read-only; requires `organization.view` |

If a future custom role lacks a capability, the navigation item is hidden and direct API access is still denied by the Worker permission gate/RLS.

## Scope validation finding

Current operational SELECT policies for several legacy/V4 operational tables are organization-membership scoped (`private.is_org_member`) rather than warehouse/org-unit permission scoped. Therefore a role assignment with `scope_type=WAREHOUSE` or `ORG_UNIT` needs an explicit row-scope acceptance pass before V4 frontend readiness can be declared.

V4_009B does not silently claim this is solved. Instead:

- `/v4/shadow/session` returns the assignment scope;
- the UI displays a visible warning when any active assignment is not ORGANIZATION scoped;
- `frontend_v4_ready` remains false;
- row-scope policy hardening is tracked as a blocker for scoped-role production acceptance.

This is safe for the current single OWNER acceptance session and for organization-scoped roles, but it is a real future multi-tenant/RBAC hardening item.

## Tablet/mobile UX hardening

The Shadow shell now:

- keeps the top bar fixed;
- switches the side navigation to a horizontally scrollable fixed navigation rail at widths <= 1100 px, covering common iPad/tablet portrait widths;
- preserves safe-area padding on iOS;
- raises interactive targets to at least 44 px on touch layouts;
- adds visible keyboard focus states and a skip-to-content link;
- keeps tables horizontally scrollable instead of compressing medical/inventory values into unreadable columns;
- collapses metric cards and page actions progressively on phone widths;
- exposes current role and assignment scope without exposing a token or secret;
- honors `prefers-reduced-motion`.

## Current data truth evidence retained from V4_009

Warehouse × drug comparison remains:

- V3 rows: 2,244
- V4 rows: 2,244
- matched keys: 2,244
- missing V3/V4 keys: 0 / 0
- quantity mismatch rows: 0
- absolute quantity delta: 0
- status mismatch rows: 1,693

The status delta is a semantic delta, not quantity truth drift. V4 distinguishes states such as `EXPIRY_RISK` and `INSUFFICIENT_DATA` that V3 did not represent equivalently.

## Acceptance status

### Passed in code/CI

- GET-only Shadow worker boundary.
- no service-role marker in Shadow worker/access sources.
- route-to-permission mapping tests.
- role/session UI JavaScript syntax.
- TypeScript compilation.
- existing Shadow and gateway tests.
- mobile/tablet CSS source present and isolated from production UI.

### Still blocking `frontend_v4_ready=true`

1. Real browser session validation for PHARMACY_MANAGER, PHARMACIST and AUDITOR accounts (current production org only has an active OWNER acceptance account in this workflow).
2. Explicit warehouse/org-unit row-scope RLS acceptance and hardening for scoped role assignments.
3. Real non-production/preview deployment visual QA on iPad/tablet/mobile.
4. Founder/release-gate approval before any production promotion.

## Production invariant

V4_009B must not modify:

- `cutover_stage` — remains `SHADOW`;
- `inventory_write_mode` — remains `LEGACY`;
- `alert_publish_mode` — remains `SHADOW`;
- `his_ingestion_mode` — remains `HYBRID`;
- `frontend_v4_ready` — remains `false`;
- canonical inventory ledger.
