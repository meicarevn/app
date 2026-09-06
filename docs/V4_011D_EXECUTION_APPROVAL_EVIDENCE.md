# V4_011D — Founder A Approval Evidence

Founder A explicitly approved the scoped V4_011D Controlled Read-Path Promotion on 2026-09-06 (Asia/Ho_Chi_Minh):

> Tôi là Founder A và phê duyệt V4_011D Controlled Read-Path Promotion theo phạm vi PR #30.

Scope authorized by that approval:

- promote only the normal V4_011 **Shadow** read endpoint from Cloudflare/TypeScript semantic projection to `public.inventory_intelligence_multi_axis_v4_011` as semantic primary source;
- preserve human JWT authentication, `inventory.view`, ORGANIZATION scope and Supabase RLS;
- preserve GET-only/no-service-role/no-mutation behavior;
- preserve Founder B-approved A1/B1 semantics;
- preserve the existing Shadow UI response contract;
- deploy first only to the existing isolated V4_011 Shadow alias;
- keep global frontend routing unchanged;
- keep `frontend_v4_ready=false`;
- keep inventory writes LEGACY and alert publication SHADOW;
- no IAM, secret, permission or RLS changes.

Rollback remains route-only: restore the previous `inventory_intelligence_v4 + projectMultiAxisRows` implementation and redeploy the previous known-good V4_011 Shadow alias revision. No database rollback is required.
