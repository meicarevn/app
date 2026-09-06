# V4_009G — Frontend Member Admin Canary & Controlled Routing

Status: **CONTROLLED CANARY ACCEPTED / FRONTEND V4 GLOBAL READINESS REMAINS OFF**

Issues: #14, #16, #17

## Objective

Route the new member-administration UI to `meicare-member-admin-v4` only during an explicitly approved canary. Keep the legacy production member administration flow as an independent rollback path. Never silently fall back from a failed V4 write to a legacy write.

## Founder A approval

Founder A explicitly approved production execution of **V4_009G Controlled Canary Activation** on 2026-09-06. The approval is recorded in PR #15 before production Edge Function deployment and controlled frontend canary routing.

## Production invariants

Post-acceptance production verification confirms:

- `cutover_stage = SHADOW`
- `inventory_write_mode = LEGACY`
- `alert_publish_mode = SHADOW`
- `his_ingestion_mode = HYBRID`
- `frontend_v4_ready = false`
- `integration_layer_ready = false`
- `r2_gateway_ready = false`
- `iot_gateway_ready = false`
- `ai_orchestrator_ready = false`
- inventory ledger drift rows = 0
- current primary membership remains `OWNER / ACTIVE`
- current OWNER V4 role assignment remains active at `ORGANIZATION` scope
- no OWNER lifecycle audit row was created by the protection test because the attempted status change was rejected before mutation.

V4 member lifecycle/database migrations from V4_009F remain deployed. Legacy `meicare-member-admin` version 2 remains ACTIVE as rollback infrastructure. Browser code never contains a service-role/secret key.

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

GitHub Actions successfully deployed the controlled preview to the existing Pages project `meicare-smart-pharmacy` using repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Deployment evidence:

- branch alias: `v4-009g-canary`;
- stable preview URL: `https://v4-009g-canary.meicare-smart-pharmacy.pages.dev`;
- first successful deployment URL observed: `https://d107c853.meicare-smart-pharmacy.pages.dev`;
- Cloudflare deploy step = PASS;
- static canary guards = PASS.

Follow-up workflow run **34012497621** completed successfully after redeploying the branch preview and included live preview smoke.

Passed live preview checks:

1. preview root returns HTTP 200 and contains the V4_009G canary marker;
2. `GET /api/member-admin` returns 405;
3. POST without canary marker returns 403 `CANARY_HEADER_REQUIRED`;
4. POST with canary marker but no JWT returns 401 `AUTH_REQUIRED`;
5. POST with an invalid JWT remains 401 and no member mutation is accepted.

Associated branch validation also passed:

- V4 Shadow Read CI = PASS;
- V4 Gateway CI = PASS;
- V4_009G Cloudflare Pages Canary = PASS, including live preview smoke.

## Authenticated Founder A acceptance

Founder A completed the authenticated browser acceptance against the isolated Cloudflare Pages canary and reported **PASS**.

Acceptance path:

1. sign in with the current Founder A / OWNER account;
2. confirm the canary displays the current OWNER membership as ACTIVE;
3. execute the OWNER protection no-op test;
4. database returns the expected conflict/rejection rather than allowing OWNER suspension;
5. log out so the in-memory browser access token is cleared.

Post-acceptance database verification confirms:

- primary membership `bd0f29e4-a42e-4d20-b37e-0ce3cfc60779` is still `ACTIVE` with legacy display role `OWNER`;
- active V4 assignment remains role `OWNER`, scope `ORGANIZATION`, `valid_to IS NULL`;
- no lifecycle-history row exists for the rejected OWNER protection request, consistent with no accepted lifecycle mutation;
- inventory ledger drift remains 0;
- all V4 global readiness flags remain false.

The successful 409/rejection is the intended acceptance outcome. No temporary member, invite, role assignment, or inventory mutation was created by V4_009G authenticated acceptance. Full successful lifecycle mutation behavior had already been exercised transactionally in V4_009F controlled acceptance.

## Canary decision

The browser/controller path remains fail-closed.

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

The Founder A acceptance page remains an isolated branch preview and is not the normal production UI:

`https://v4-009g-canary.meicare-smart-pharmacy.pages.dev`

Normal users remain on the existing production UI. The preview may be retained temporarily for evidence/retest or removed later without affecting production routing.

## Rollback

Rollback does not perform a write retry. The controlled Pages branch preview can stop being used/removed while normal users remain on the existing production UI. Legacy `meicare-member-admin` v2 remains ACTIVE. V4_009F database changes are additive; frontend rollback does not require inventory or ledger mutation.

If the V4 Edge canary itself must be rolled back, callers can remain on legacy `meicare-member-admin` v2 or the previous V4 source can be redeployed. Do not alter inventory truth as part of member-admin rollback.

## Release gate conclusion

**V4_009G Controlled Canary Acceptance = PASS.**

This closes the controlled canary validation for the member-admin V4 route. It does **not** authorize:

- setting `frontend_v4_ready=true`;
- switching inventory writes away from LEGACY;
- publishing V4 alerts globally;
- changing the global cutover stage;
- merging or deploying unrelated high-risk changes without their required release evidence/approvals.

The next frontend step must be treated as a separate release-readiness stage with its own acceptance criteria and Founder A approval where applicable.
