# V4_011C — Controlled Production Read-Path Canary

Status: **ISOLATED PREVIEW DEPLOYED / AUTOMATED CANARY SMOKE PASS / AUTHENTICATED PARITY ACCEPTANCE PENDING**

Tracking: #27

Preview: `https://v4-011c-db-read-canary.meicare-smart-pharmacy.pages.dev/multi-axis-canary`

## Purpose

Validate the production additive projection installed by V4_011B through a real application read path before any frontend routing migration.

The canary deliberately keeps two paths in parallel:

1. **Primary canary path:** direct read from `public.inventory_intelligence_multi_axis_v4_011` through PostgREST using the original human JWT and underlying scoped RLS.
2. **Comparison path:** read `public.inventory_intelligence_v4` through the same human JWT and run the existing TypeScript `projectMultiAxisRows` projection in Cloudflare.

The normal V4_011 Shadow endpoint remains unchanged.

## Endpoint

`GET /v4/shadow/intelligence-v4-011-canary`

Properties:

- GET only;
- requires `inventory.view`;
- requires ORGANIZATION scope for the full-organization parity check;
- uses the original user JWT;
- uses only the public/publishable Supabase key;
- no service-role credential;
- no mutation RPC;
- no inventory, alert, runtime, or readiness mutation;
- all responses are `no-store` and marked `X-Meicare-Canary: V4_011C`.

## Comparison contract

Parity is checked per warehouse×drug operational key for:

- `quantity_on_hand`;
- `usable_quantity`;
- `availability_state`;
- `expiry_state`;
- `evidence_state`;
- `recommendation_state`;
- `expiry_evidence_mode`;
- `recommendation_requires_human_review`;
- `suppress_expected_wastage_claims`.

Any mismatch is surfaced with bounded samples. The canary does not normalize mismatches away.

## Production read-only parity preflight — PASS

Before deployment, production was compared with read-only SQL using the current TypeScript semantics translated exactly into SQL and joined to the new DB projection.

Result over the current 2,244 operational keys:

- availability mismatch = 0;
- expiry mismatch = 0;
- evidence mismatch = 0;
- recommendation mismatch = 0;
- expiry-evidence-mode mismatch = 0;
- expected-wastage suppression mismatch = 0;
- rows with any mismatch = 0.

This is supporting evidence only. The Cloudflare canary still performs the comparison through the real authenticated application read path.

## Automated isolated deployment — PASS

Current branch head: `b738fdcdf4a93acff2180b9dd6b465e10a36dda4`.

GitHub Actions evidence:

- V4_011C Controlled DB Read-path Canary run `34023560560`: SUCCESS;
- V4 Shadow Read CI run `34023575380`: SUCCESS;
- V4 Gateway CI run `34023575422`: SUCCESS.

The V4_011C workflow passed:

- dependency install;
- TypeScript typecheck;
- unit tests including exact-parity and fail-visible mismatch tests;
- browser JavaScript syntax checks;
- service-role / mutation static guards;
- isolated Cloudflare Pages deployment;
- live canary page HTTP 200 smoke;
- unauthenticated canary endpoint HTTP 401 smoke;
- POST fail-closed HTTP 405 smoke.

## Current controlled acceptance reference

At the V4_011B production migration boundary:

- rows = 2,244;
- QOH = 4,953,566;
- A1 = 284 = 39 `TRANSFER_REVIEW` + 245 `PROCUREMENT_REVIEW`;
- B1 = 19 = 3 CRITICAL + 4 HIGH + 12 WARNING;
- B1 `TIME_WINDOW_ONLY` = 19;
- recommendations without human-review flag = 0;
- ledger drift = 0.

The browser canary reports whether this snapshot still matches, but semantic parity is evaluated independently so legitimate future inventory changes do not get silently treated as code drift.

## Production invariant after isolated preview deployment — PASS

Read-only verification after the Pages deployment confirms:

- additive projection still returns 2,244 rows;
- inventory ledger drift = 0;
- `cutover_stage = SHADOW`;
- `inventory_write_mode = LEGACY`;
- `alert_publish_mode = SHADOW`;
- `his_ingestion_mode = HYBRID`;
- `frontend_v4_ready = false`;
- `integration_layer_ready = false`;
- `r2_gateway_ready = false`;
- `iot_gateway_ready = false`;
- `ai_orchestrator_ready = false`.

## Remaining acceptance

Authenticated human acceptance is still required because CI intentionally does not possess or store a user's Supabase password/JWT.

Using the existing MEICARE account, open the isolated canary page and confirm that it reports:

- `V4_011C canary PASS`;
- `EXACT PARITY`;
- mismatch rows = 0;
- missing DB = 0;
- missing Cloudflare = 0;
- unsafe recommendations = 0.

Do not share the password or JWT in GitHub or ChatGPT.

## Release boundary

This step does **not** authorize:

- changing the normal V4_011 Shadow endpoint to the DB path;
- setting `frontend_v4_ready=true`;
- global frontend routing changes;
- alert publication cutover;
- inventory-write cutover;
- broader V4 PR merge.

Promotion requires a separate gate after the isolated canary is green and authenticated human acceptance is recorded.
