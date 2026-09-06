# V4_009G — Frontend Member Admin Canary & Controlled Routing

Status: **PREPARED / NOT ENABLED IN PRODUCTION FRONTEND**

Issue: #14

## Objective

Route the new member-administration UI to `meicare-member-admin-v4` only during an explicitly approved canary. Keep the legacy production member administration flow as an independent rollback path. Never silently fall back from a failed V4 write to a legacy write.

## Production invariants

- `cutover_stage = SHADOW`
- `frontend_v4_ready = false`
- V4 member lifecycle/database migrations from V4_009F remain deployed.
- `meicare-member-admin-v4` remains deployed with `verify_jwt = true`.
- legacy `meicare-member-admin` remains available as rollback infrastructure.
- browser code never contains a service-role/secret key.

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
- 403: authenticated user lacks organization-level `membership.manage`.
- 409: lifecycle/role conflict; show controlled conflict, do not retry legacy.
- 5xx: V4 unavailable; stop the operation, do not retry legacy.

## Rollout sequence

1. CI green on the V4_009G branch/PR.
2. Record Founder A approval for V4_009G frontend routing.
3. Deploy the Shadow/Canary frontend only; do not replace the normal production member-admin route.
4. Inject `memberAdminMode: "V4_CANARY"` only into the approved canary deployment/session.
5. Validate read-only state when flag is absent/OFF.
6. Validate 401 with missing/invalid session.
7. Validate 403 with an authenticated account lacking `membership.manage` if a suitable controlled test account is available.
8. With an approved admin account, validate invite -> self-activate -> suspend -> reactivate -> disable and role assignment/end.
9. Verify audit trail and scoped visibility (Warehouse Staff @ Kho 1 = 667 inventory rows and 1 warehouse under the current acceptance dataset).
10. Verify no temporary users/members/audit test rows remain and ledger drift remains 0.
11. Keep `frontend_v4_ready=false` until separate frontend acceptance and release approval.

## Rollback

Rollback does not perform a write retry. It consists of disabling/removing the canary frontend route/config and returning users to the existing legacy UI. Because V4_009F database changes are additive and the legacy Edge Function remains present, rollback of the frontend route does not require inventory or ledger mutation.

## Release gate

V4_009G changes routing for an authentication/authorization administration workflow. Per `.github/MEICARE_RELEASE_GATE.md`, enabling/deploying this canary to production-facing frontend traffic requires Founder A approval. Preparation, CI, and static validation may proceed without enabling the route.
