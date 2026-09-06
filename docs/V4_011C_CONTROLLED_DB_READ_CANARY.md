# V4_011C — Controlled Production Read-Path Canary

Status: **ISOLATED READ-ONLY CANARY / NO GLOBAL CUTOVER**

Tracking: #27

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

## Production read-only parity preflight

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

## Release boundary

This step does **not** authorize:

- changing the normal V4_011 Shadow endpoint to the DB path;
- setting `frontend_v4_ready=true`;
- global frontend routing changes;
- alert publication cutover;
- inventory-write cutover;
- broader V4 PR merge.

Promotion requires a separate gate after the isolated canary is green and authenticated human acceptance is recorded.
