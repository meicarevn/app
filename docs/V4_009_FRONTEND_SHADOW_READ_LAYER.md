# V4_009 — Frontend Shadow Read Layer

Status: **implemented on stacked review branch; not deployed; production runtime unchanged**.

V4_009 adds a read-only, RLS-aware observation layer so MEICARE can validate V4 UX and semantics before changing the production frontend or cutover stage.

## Architecture

```text
Existing production UI
        ↓
       V3

V4 shadow UI (separate Pages candidate)
        ↓ user JWT only
meicare-v4-shadow-read Worker
        ↓ same user JWT + anon key
Supabase PostgREST / RLS
        ↓
V4 read models + V3 comparison view
```

The shadow Worker intentionally has **no service-role key, no R2 binding, no Durable Object and no write endpoint**. Its `wrangler.shadow.toml.example` contains only:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (encrypted secret)
- `SHADOW_ALLOWED_ORIGIN`

## Read routes

All routes require an authenticated Supabase access token and a valid `organization_id`. The original user bearer token is forwarded to Supabase so RLS/permission checks remain authoritative.

- `GET /health`
- `GET /v4/shadow/overview`
- `GET /v4/shadow/inventory`
- `GET /v4/shadow/actions`
- `GET /v4/shadow/reconciliations`
- `GET /v4/shadow/iot`
- `GET /v4/shadow/documents`
- `GET /v4/shadow/readiness`
- `GET /v4/shadow/compare/inventory`

List routes use bounded pagination. Shadow requests do not call inventory mutation, approval, action-execution, reconciliation-commit or runtime-cutover RPCs.

## Shadow UI

`web-shadow/` is a dependency-free, Cloudflare Pages-ready responsive UI shell with:

- fixed top navigation and responsive tablet/mobile navigation;
- permanent `SHADOW · READ ONLY` banner;
- Overview;
- Inventory Intelligence;
- Action Center;
- HIS reconciliation;
- IoT/GSP health;
- Document Registry / Evidence summary;
- V3 ↔ V4 inventory comparison;
- Production Gate viewer.

There are deliberately **no approve, execute, commit, quarantine, policy-change or cutover buttons**.

The development shell stores Gateway URL, organization id and normal user access token in `sessionStorage` only. It never asks for or accepts a service-role key.

## V3 ↔ V4 comparison semantics

The comparison route uses the same operational key on both sides:

```text
warehouse_id + drug_id
```

It compares quantity-on-hand and stock-status separately so a semantics change cannot be mistaken for a truth drift.

Current database evidence for the primary organization at implementation time:

```text
V3 warehouse rows           2244
V4 rows                     2244
Matched keys                2244
Missing in V3               0
Missing in V4               0
Quantity mismatch rows      0
Absolute quantity delta     0
Status mismatch rows        1693
```

The large status mismatch is expected and must not be normalized away. V3 currently has only:

```text
DEFAULT_HEALTHY      1403
DEFAULT_LOW_STOCK     120
OUT_OF_STOCK          721
```

while V4 currently has:

```text
HEALTHY              1390
DEFAULT_LOW_STOCK     114
OUT_OF_STOCK          437
EXPIRY_RISK            19
INSUFFICIENT_DATA     284
```

The V4 statuses intentionally encode richer evidence semantics. In particular, `INSUFFICIENT_DATA` prevents a lack of demand history from being silently treated as healthy/out-of-stock logic, and `EXPIRY_RISK` is independently surfaced. Therefore the cutover gate should require **quantity/key truth alignment** plus reviewed explanations for status-semantic differences, not literal status equality with V3.

## Security / UX guarantees

1. Only `GET` is accepted by `handleShadowRead`; mutation methods fail with `405 METHOD_NOT_ALLOWED` before upstream access.
2. User JWT is validated through Supabase Auth before reads.
3. The same JWT is used for PostgREST; no privilege elevation occurs.
4. Organization id must be a UUID and every query adds the tenant filter.
5. CORS can be restricted to one configured shadow Pages origin.
6. Responses are `no-store` and carry a request id.
7. Production Gate is display-only.
8. The UI clearly labels itself SHADOW on desktop, tablet and mobile.

## CI

`V4 Shadow Read CI` checks:

- TypeScript typecheck for all Worker sources;
- unit tests, including read-only method rejection and JWT/RLS propagation;
- browser JavaScript syntax;
- static guard that the shadow modules contain neither mutation-fetch markers nor `SUPABASE_SERVICE_ROLE_KEY`.

## Promotion rules

V4_009 does **not** set `frontend_v4_ready=true` and does not change:

```text
cutover_stage        = SHADOW
inventory_write      = LEGACY
alert_publish        = SHADOW
HIS ingestion        = HYBRID
```

Before `frontend_v4_ready` can be considered:

1. deploy the shadow Worker/Pages only to a non-production URL;
2. authenticate with real user roles and verify tenant/RLS behavior;
3. validate tablet/mobile/desktop layouts;
4. compare representative inventory rows and risk explanations with pharmacy users;
5. confirm Action Center/IoT/Documents remain read-only;
6. document discrepancies and acceptance criteria;
7. obtain the applicable founder approval under `.github/MEICARE_RELEASE_GATE.md`.

No production deployment is part of this branch.
