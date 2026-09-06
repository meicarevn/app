# V4_009G — Frontend Member Admin Canary & Controlled Routing

Status: **EDGE CANARY ACTIVE / FRONTEND CANARY ROUTE NOT YET DEPLOYED**

Issues: #14, #16, #17

## Objective

Route the new member-administration UI to `meicare-member-admin-v4` only during an explicitly approved canary. Keep the legacy production member administration flow as an independent rollback path. Never silently fall back from a failed V4 write to a legacy write.

## Founder A approval

Founder A explicitly approved production execution of **V4_009G Controlled Canary Activation** on 2026-09-06. The approval is recorded in PR #15 before production Edge Function deployment.

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

Latest branch CI at commit `ed6271286b13cfaac9ad6ac98022e3a1e26a1565` also passed:

- V4 Shadow Read CI = PASS;
- V4 Gateway CI = PASS.

## Canary decision

The browser controller is fail-closed.

```text
memberAdminMode != V4_CANARY
        -> READ ONLY

memberAdminMode = V4_CANARY
        + exact HTTPS endpoint
        + same approved Supabase origin
        + /functions/v1/meicare-member-admin-v4
        -> governed V4 writes enabled
```

An invalid endpoint, query string, alternate host, HTTP URL, or legacy function path disables writes.

## Approved endpoint

`https://sgxufmcsnveyyddazwuk.supabase.co/functions/v1/meicare-member-admin-v4`

The canary controller does not contain a legacy write endpoint. Legacy rollback is navigation/deployment routing only, never an automatic retry target.

## Request contract

Every V4 canary write sends:

- the current user's `Authorization: Bearer <JWT>`;
- JSON request body;
- `X-Request-Id`;
- `X-Meicare-Canary: V4_009G`.

No service credential is sent to the browser or forwarded from the browser.

## Error behavior

- 401: session invalid/expired; require login again.
- 403: authenticated user lacks organization-level `membership.manage` or the controlled canary gate rejects the request.
- 409: lifecycle/role conflict; show controlled conflict, do not retry legacy.
- 5xx: V4 unavailable; stop the operation, do not retry legacy.

## Remaining frontend activation boundary

The production Edge canary is active, but the **production-facing Cloudflare Pages canary route/session has not been enabled** from this execution environment.

The repository default branch currently does not contain the application/shadow frontend tree, and no Cloudflare management connector/plugin is available to perform a targeted Pages preview deployment. Therefore the rollout intentionally stops before guessing or replacing the existing Cloudflare deployment.

Consequences:

- production legacy UI remains unchanged;
- `memberAdminMode` is not globally enabled;
- no authenticated Founder A browser session was routed through V4_009G by this run;
- no live invite/member mutation was created as part of V4_009G activation;
- the previously completed V4_009F controlled database acceptance remains the lifecycle/RBAC mutation evidence.

## Remaining authenticated canary acceptance

Once a controlled Cloudflare canary deployment/session is available, complete only the following scoped checks:

1. inject `memberAdminMode: "V4_CANARY"` only for the Founder A canary deployment/session;
2. verify normal production member-admin route remains legacy/unmodified;
3. verify 401 with expired/invalid login;
4. verify 403 with a controlled account lacking `membership.manage`;
5. with the approved admin session, validate one controlled lifecycle flow (invite -> self-activate -> suspend -> reactivate -> disable) and role assignment/end;
6. verify audit trail and scoped visibility;
7. remove temporary acceptance account/data;
8. verify ledger drift remains 0;
9. switch canary flag back to `OFF` and verify the V4 write UI becomes read-only.

## Rollback

Rollback does not perform a write retry. It consists of disabling/removing the canary frontend route/config and returning users to the existing legacy UI. The legacy Edge Function remains ACTIVE. V4_009F database changes are additive; frontend rollback does not require inventory or ledger mutation.

If the V4 Edge canary itself must be rolled back before frontend activation, redeploy the previously preserved version-1 source of `meicare-member-admin-v4` or keep callers on legacy `meicare-member-admin` v2. Do not alter inventory truth as part of member-admin rollback.

## Release gate

Founder A approval for V4_009G Controlled Canary Activation is recorded. This approval authorized the controlled production Edge revision and canary frontend routing only. It does **not** authorize setting `frontend_v4_ready=true`, switching inventory writes away from LEGACY, or changing the global cutover stage.
