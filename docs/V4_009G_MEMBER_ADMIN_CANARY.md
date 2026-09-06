# V4_009G — Frontend Member Admin Canary & Controlled Routing

Status: **EDGE CANARY ACTIVE / CLOUDFLARE FRONTEND CANARY DEPLOYED / AUTHENTICATED FOUNDER A ACCEPTANCE PENDING**

Issues: #14, #16, #17

## Objective

Route the new member-administration UI to `meicare-member-admin-v4` only during an explicitly approved canary. Keep the legacy production member administration flow as an independent rollback path. Never silently fall back from a failed V4 write to a legacy write.

## Founder A approval

Founder A explicitly approved production execution of **V4_009G Controlled Canary Activation** on 2026-09-06. The approval is recorded in PR #15 before production Edge Function deployment and controlled frontend canary routing.

## Production invariants

- `cutover_stage = SHADOW`
- `inventory_write_mode = LEGACY`
- `alert_publish_mode = SHADOW`
- `his_ingestion_mode = HYBRID`
- `frontend_v4_ready = false`
- `integration_layer_ready = false`
- `r2_gateway_ready = false`
- `iot_gateway_ready = false`
- `ai_orchestrator_ready = false`
- ledger drift rows = 0
- V4 member lifecycle/database migrations from V4_009F remain deployed.
- legacy `meicare-member-admin` version 2 remains ACTIVE as rollback infrastructure.
- browser code never contains a service-role/secret key.

## Production Edge Function activation

`meicare-member-admin-v4` was promoted from version 1 to **version 2**, remains `ACTIVE`, and keeps `verify_jwt = true`.

Version 2 adds the V4_009G gate:

- exact `X-Meicare-Canary: V4_009G` marker required by the function body for POST requests that reach the function;
- CORS allowlist includes `x-meicare-canary`;
- allowed origin remains controlled by `ALLOWED_ORIGINS` / `SITE_URL` with production fallback `https://meicare-smart-pharmacy.pages.dev`;
- no legacy write fallback path is present in the V4 function.

## Live public Edge smoke evidence

GitHub Actions workflow `V4_009G Live Edge Smoke`, run **34009906601**, completed successfully against the deployed production function without using a valid user token and without performing a member mutation.

Passed checks:

1. allowed production-origin CORS preflight = PASS;
2. `x-meicare-canary` present in allowed request headers = PASS;
3. disallowed-origin preflight fails closed = PASS;
4. canary POST without JWT rejected = PASS;
5. invalid JWT rejected without mutation = PASS.

## Cloudflare Pages controlled frontend canary

GitHub Actions rerun of workflow `V4_009G Cloudflare Pages Canary` successfully detected the newly configured repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and deployed the controlled preview to the existing Pages project `meicare-smart-pharmacy`.

Deployment evidence:

- branch alias: `v4-009g-canary`;
- stable preview URL: `https://v4-009g-canary.meicare-smart-pharmacy.pages.dev`;
- first successful deployment URL observed: `https://d107c853.meicare-smart-pharmacy.pages.dev`;
- Cloudflare deploy step = PASS;
- static canary guards = PASS.

A follow-up workflow revision added **live preview smoke**. Run **34012497621** completed successfully after redeploying the branch preview.

Passed live preview checks:

1. preview root returns HTTP 200 and contains the V4_009G canary marker;
2. `GET /api/member-admin` returns 405;
3. POST without canary marker returns 403 `CANARY_HEADER_REQUIRED`;
4. POST with canary marker but no JWT returns 401 `AUTH_REQUIRED`;
5. POST with an invalid JWT remains 401 and no member mutation is accepted.

Latest branch CI at commit `e8753a3521d33eb8a99d04b321e7d963d6dd84af` also passed:

- V4 Shadow Read CI = PASS;
- V4 Gateway CI = PASS;
- V4_009G Cloudflare Pages Canary = PASS, including live preview smoke.

## Canary decision

The browser controller is fail-closed.

```text
memberAdminMode != V4_CANARY
        -> READ ONLY

memberAdminMode = V4_CANARY
        + exact approved route
        + human Supabase JWT
        + X-Meicare-Canary: V4_009G
        -> governed V4 writes enabled
```

An invalid endpoint, query string, alternate host, HTTP URL, missing marker, invalid session, or legacy function path disables/stops writes. No V4 failure is automatically retried through legacy V2.

## Controlled frontend route

The Founder A acceptance page is deployed as an isolated branch preview and is not the normal production UI:

`https://v4-009g-canary.meicare-smart-pharmacy.pages.dev`

The page:

- uses the normal Supabase Auth login;
- keeps the access token in memory for the current tab only;
- does not contain a service-role/secret key;
- sends writes through same-origin `/api/member-admin`;
- preserves the human JWT and adds the V4_009G canary marker;
- exposes an OWNER-protection no-op acceptance action that must return 409 rather than changing OWNER status.

## Remaining authenticated canary acceptance

Only the authenticated Founder A browser acceptance remains:

1. open the controlled preview URL;
2. sign in with the existing Founder A/OWNER account;
3. verify the displayed organization, membership, OWNER role and ACTIVE status;
4. run the OWNER protection test and require expected 409 with no status mutation;
5. optionally perform a dedicated temporary lifecycle/role acceptance account only if explicitly desired;
6. verify audit/scoped visibility if any temporary mutation test is performed;
7. log out so the in-memory tab token is cleared;
8. verify ledger drift remains 0;
9. keep `frontend_v4_ready=false` until separate frontend release acceptance/approval.

## Rollback

Rollback does not perform a write retry. The controlled Pages branch preview can simply stop being used/removed, while normal users remain on the existing production UI. The legacy `meicare-member-admin` v2 remains ACTIVE. V4_009F database changes are additive; frontend rollback does not require inventory or ledger mutation.

If the V4 Edge canary itself must be rolled back, callers can remain on legacy `meicare-member-admin` v2 or the previous V4 source can be redeployed. Do not alter inventory truth as part of member-admin rollback.

## Release gate

Founder A approval for V4_009G Controlled Canary Activation is recorded. This approval authorized the controlled production Edge revision and isolated frontend canary routing only. It does **not** authorize setting `frontend_v4_ready=true`, switching inventory writes away from LEGACY, or changing the global cutover stage.
