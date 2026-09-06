# V4_011D — Founder A Approval Evidence

Date: 2026-09-06

Explicit Founder A approval received in the MEICARE project conversation:

> Tôi là Founder A và phê duyệt V4_011D Controlled Read-Path Promotion theo phạm vi PR #30.

Durable GitHub evidence:

- PR #30 approval-record comment: `5558478642`;
- Issue #29 approval-record comment: `5558479304`.

Authorized scope:

- promote the normal V4_011 Shadow read path to `public.inventory_intelligence_multi_axis_v4_011`;
- preserve original human JWT authentication;
- preserve `inventory.view` authorization and ORGANIZATION-scope requirement;
- preserve Supabase RLS as final authority;
- public/publishable Supabase key only;
- GET-only behavior;
- no service-role credential;
- no inventory write or alert publication change;
- no readiness-flag promotion;
- no clinical-semantic change to Founder B-approved A1/B1.

Execution must occur in a separate controlled execution PR with rollback evidence. This approval does not authorize global frontend cutover, inventory-write cutover, alert publication cutover, IAM/secrets/RLS changes, or setting `frontend_v4_ready=true`.
