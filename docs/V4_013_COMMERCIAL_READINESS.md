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

1. TypeScript check and all tests pass.
2. Browser assets contain no service-role/secret key marker.
3. Browser assets contain no hard-coded production organization ID.
4. Login does not ask for an organization UUID or access token.
5. Organization discovery uses the caller's JWT and existing security-invoker/RLS paths.
6. Token refresh replaces both access and single-use refresh tokens.
7. Logout uses local scope and clears the tab session even when the network call fails.
8. Preview deployment targets only the V4_013 branch of `meicare-platform`.

## Promotion rule

V4_013A may be merged or deployed only as an isolated preview after automated checks and authenticated human acceptance. It cannot authorize commercial go-live or any readiness/cutover mutation.
