# MEICARE V4_013 — Commercial Readiness & Lighthouse Pilot

## Outcome

Convert the accepted V4_012 isolated read platform into a commercially usable lighthouse-pilot release without changing the current production route, write path, alert publication mode, or rollback system.

## Accepted baseline

- Dedicated frontend: `meicare-platform` on Cloudflare Pages.
- V4_012 authenticated human acceptance: PASS.
- Runtime remains `SHADOW / LEGACY / SHADOW / HYBRID`.
- `frontend_v4_ready=false` and all integration readiness flags remain false.
- Existing `meicare-smart-pharmacy` deployment remains the rollback path.
- Supabase RLS remains the final data-access authority.

## Commercial V1 scope

1. Inventory intelligence by drug code × warehouse, with lot/expiry traceability.
2. Action Center and the three core alert families: six-month expiry, low stock, and 30-day slow movement.
3. Authenticated multi-organization access with role/scope enforcement.
4. One controlled VNPT-HIS adapter with idempotency, reconciliation, stale-sync detection, and evidence.
5. Audit/evidence path through Supabase metadata and Cloudflare R2 objects.
6. Optional IoT/GSP add-on with per-device credentials and calibration evidence.
7. AI/PAR remains advisory, explainable, versioned, and human-approved.

## Excluded from this program

- Global DNS or production frontend cutover.
- `frontend_v4_ready=true` or any other readiness mutation.
- Inventory-write or alert-publication promotion.
- Removal of V2/V3 data or rollback assets.
- Autonomous clinical, procurement, inventory, or PAR actions.
- Patient-identifiable data.

## Workstreams and gates

| Workstream | Exit evidence |
|---|---|
| A. Commercial auth | No hard-coded tenant; no pasted token/UUID; refresh/logout; RLS-derived organization selection; cross-tenant tests |
| B. Frontend hardening | Route fallbacks; phone/tablet/desktop acceptance; accessibility; security headers; noindex; rollback proof |
| C. HIS integration | One live connection; immutable raw evidence; idempotent staging; reconciliation; 14-day stable run |
| D. Security | Privileged RPC review; least privilege; dependency/secret checks; no unresolved High/Critical issue |
| E. Resilience | Backup restore drill; RPO/RTO; observability; incident and rollback rehearsal |
| F. Pilot acceptance | Founder B clinical sign-off; signed pilot documents; baseline/outcome KPIs; 3–5 warehouses |

## Increment V4_013A — Session and tenant foundation

This increment is isolated and read-only. It:

- creates an RLS-backed `/v4/shadow/organizations` resolver;
- removes the hard-coded organization from login;
- removes the manual Gateway URL, organization UUID, and access-token entry UI;
- auto-selects a sole organization and offers a selector for multiple memberships;
- adds refresh-token rotation, one-time 401 retry, and local-session logout;
- pins runtime development dependencies and adds commercial safety guards.

It does not change Supabase schema, RLS, IAM, secrets, runtime modes, production routes, or existing production deployments.

## V4_013A acceptance

Status: **PASS** — accepted by the product owner after isolated-preview review.

1. TypeScript check and all tests pass.
2. Browser assets contain no service-role/secret key marker.
3. Browser assets contain no hard-coded production organization ID.
4. Login does not ask for an organization UUID or access token.
5. Organization discovery uses the caller's JWT and existing security-invoker/RLS paths.
6. Token refresh replaces both access and single-use refresh tokens.
7. Logout uses local scope and clears the tab session even when the network call fails.
8. Preview deployment targets only the V4_013 branch of `meicare-platform`.

## Increment V4_013B — Frontend hardening

This increment keeps the same authenticated, read-only boundary while making the pilot interface safer under ordinary commercial operating conditions. It adds:

- session-expiry messaging and deterministic redirect to login;
- retryable network/service errors without discarding the last successfully rendered view;
- an offline banner and automatic retry after connectivity returns;
- a branded static 404 fallback;
- phone, tablet, keyboard-focus, reduced-motion, and dark-mode refinements;
- restrictive headers for both static assets and Pages Function responses;
- CI smoke checks for security headers, unknown routes, baseline availability, and rollback availability.

## V4_013B acceptance

1. TypeScript, unit/static tests, browser JavaScript syntax checks, and dependency audit pass.
2. Static pages and Pages Functions emit the required security headers.
3. An unknown preview route returns the branded 404 with HTTP 404.
4. Expired sessions return to login with a clear explanation.
5. Transient failures preserve the last rendered data and offer an explicit retry.
6. Phone/tablet layouts retain organization selection, navigation, and logout.
7. Keyboard focus and reduced-motion preferences are supported.
8. CI proves both the unchanged baseline project and the rollback project remain reachable.
9. Human acceptance occurs only on the isolated V4_013 preview.

## Promotion rule

Each V4_013 increment may be merged or deployed only as an isolated preview after automated checks and authenticated human acceptance. It cannot authorize commercial go-live or any readiness/cutover mutation.
