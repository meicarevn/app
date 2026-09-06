# V4_012 — Dedicated MEICARE Platform Frontend

## Purpose

Create a separate Cloudflare Pages project for the V4 frontend so V4 can evolve and be accepted independently of the existing `meicare-smart-pharmacy` frontend.

## Cloudflare boundary

- Project: `meicare-platform`
- Canonical target: `https://meicare-platform.pages.dev`
- Production branch of this isolated project: `v4-012-meicare-platform`
- Existing `meicare-smart-pharmacy` Pages project is not targeted by the V4_012 workflow.

## Runtime boundary

V4_012 is **PRE-PRODUCTION / READ ONLY**.

It preserves:
- human Supabase JWT authentication;
- same-origin Pages Functions gateway;
- Supabase RLS as final authority;
- GET-only Shadow read endpoints;
- V4_011D database-projection read path;
- Founder B-approved A1/B1 semantics;
- existing V3/global production frontend as rollback path.

It does not authorize:
- `frontend_v4_ready=true`;
- inventory write cutover;
- alert publication cutover;
- IAM/RLS/secrets changes;
- replacement or deletion of `meicare-smart-pharmacy`;
- global DNS/custom-domain cutover.

## Frontend composition

The new Pages artifact reuses the accepted V4 read-only frontend assets and Pages Functions, while replacing the root shell with dedicated `MEICARE PLATFORM · V4` branding. This avoids duplicating the accepted V4 business/read logic while providing a separate frontend deployment surface.

## Acceptance

Automated acceptance must prove:
1. dedicated root returns HTTP 200 with `MEICARE PLATFORM · V4`;
2. login and V4_011 multi-axis review are reachable;
3. unauthenticated Shadow reads fail with 401;
4. POST to Shadow read routes fails with 405;
5. deployment targets only `meicare-platform`;
6. no service-role credential is present in frontend source;
7. no readiness/cutover flag is changed.

Authenticated human acceptance is required before Issue #40 can be completed.
