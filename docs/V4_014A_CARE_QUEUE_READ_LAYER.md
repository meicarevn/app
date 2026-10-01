# MEICARE V4_014A — Pharmacy Care Queue Read Layer

## Outcome

Add a commercial-platform **Hàng đợi chăm sóc** surface without changing the
existing inventory truth, runtime modes, database schema, production route or
write permissions.

V4_014A is deliberately read-only. It turns the already accepted V4 Shadow
gateway into a safe landing surface for the MEICARE care-loop kernel while the
write/state-machine path remains separately gated.

## Product role

The commercial Pharmacy product now has two operational lenses:

1. **Kho thông minh / Action Center** — inventory and supply-risk operations.
2. **Hàng đợi chăm sóc** — explicitly emitted care signals/cases/follow-ups.

The care surface must never infer a care task from an inventory alert on its own.

## Source contract

V4_014A reads only `action_center_v4` rows whose `source_type` is one of:

- `CARE_SIGNAL`
- `CARE_CASE`
- `CARE_FOLLOWUP`

No other Action Center item is relabeled as care.

The browser/gateway exposure is intentionally narrow:

- title;
- source/reference;
- priority;
- status;
- owner-assignment presence;
- due time;
- reason code;
- recommended action;
- engine version / risk score where present.

The care read route does **not** select free-form `description` or raw
`metadata`. This reduces accidental exposure while the commercial care data
contract is still being hardened.

## Authorization

Route: `GET /v4/shadow/care`

Authorization:

- existing human Supabase JWT;
- existing organization selection;
- existing RLS;
- existing `workflow.view` permission;
- scoped roles may read only what their current RLS session exposes.

No service-role credential is introduced. No new permission code is introduced.

## Filters

Optional query filters:

- `status`
- `priority`
- `limit`
- `offset`

Status and priority values must match a bounded uppercase token grammar. They
cannot inject PostgREST filter grammar.

## UX contract

The UI is Vietnamese-first and displays:

- Mức ưu tiên
- Tác vụ
- Lý do
- Phụ trách
- Trạng thái
- Hạn xử lý
- Hành động đề xuất
- Nguồn

A due date in the past is displayed as `OVERDUE` only for a task not already
`COMPLETED`, `CLOSED` or `REJECTED`. This is a presentation aid, not a
clinical or business inference.

If there are no explicit care rows, the UI shows an empty state and explicitly
states that MEICARE does not derive care work from stock alerts.

## Safety boundary

V4_014A does not add:

- ACCEPT/REJECT mutation;
- Owner/SLA mutation;
- action recording;
- verification or close;
- real customer/patient identifiers;
- automatic medical conclusions;
- autonomous follow-up;
- database migration;
- readiness/cutover flag mutation.

Those belong to later V4_014 increments after the read layer and data contract
are accepted.

## Acceptance

V4_014A may be accepted when:

1. TypeScript and Vitest pass.
2. Care route requires `workflow.view`.
3. Care route remains RLS/JWT backed.
4. Raw `description` and `metadata` are not returned.
5. Invalid filter grammar fails closed.
6. Frontend contains the care queue and remains read-only.
7. Existing V4_013 commercial safety guards remain green.
8. Cloudflare deployment, if credentials are available, targets only the
   isolated `v4-014-care-coordination` preview.
9. Baseline and rollback deployments remain reachable.
10. No runtime/readiness mutation occurs.

## Next increment

After V4_014A acceptance, the next build increment is V4_014B:

- dedicated commercial care read model;
- versioned signal reason/policy fields;
- explicit human decision semantics;
- conditional Owner/SLA;
- action evidence;
- verification-before-close;
- append-only audit/evidence path.

V4_014B must remain additive and must not import patient-identifiable data.
