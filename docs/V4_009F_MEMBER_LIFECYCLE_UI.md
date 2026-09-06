# V4_009F — Member Lifecycle & Role Administration UI

Status: **prepared and validated in source control; production auth/authorization changes are not deployed by this branch.**

## Goal

Close the gap between V4 scoped RBAC and the real member lifecycle:

`INVITED → ACTIVE ↔ SUSPENDED → DISABLED`

with explicit role/scope governance, immutable role history and append-only audit evidence.

## Key rules

- `organization_members.role` remains a compatibility/display field only after this migration; authorization through `private.has_org_role` is resolved from current V4 `membership_roles` at `ORGANIZATION` scope.
- Invitations may not create an `OWNER`. Ownership is a separate governed transfer/assignment action.
- Invitation registration creates the membership as `INVITED`, then creates its V4 role assignment in the same database transaction.
- Only the invited authenticated user can self-activate an `INVITED` membership, and the Auth user must be confirmed.
- `SUSPENDED` preserves role assignments but removes effective access because only `ACTIVE` memberships are authorized.
- `DISABLED` ends all current non-OWNER role assignments. Reactivating a disabled member does not silently restore ended roles; an administrator must assign roles again.
- A membership holding a current OWNER assignment cannot be suspended or disabled. End/transfer the OWNER assignment first under the existing last-owner rules.
- Every lifecycle and role change requires an audit reason.
- Direct authenticated DML against `organization_members` and `membership_roles` remains revoked; writes flow through V4 RPCs.

## V4 RPC contract prepared

- `validate_member_invite_v4`
- `register_invited_member_v4`
- `activate_my_invited_memberships_v4`
- `set_member_status_v4`
- existing `assign_membership_role_v4`
- existing `end_membership_role_v4`

All new public database entrypoints are designed as `SECURITY INVOKER` wrappers over private implementations.

## Read models for Shadow UI

- `member_admin_v4`
- `member_lifecycle_history_v4`
- `member_role_scope_catalog_v4`
- `member_scope_targets_v4`

The Shadow Worker remains externally GET-only. Member administration read routes are:

- `GET /v4/shadow/members`
- `GET /v4/shadow/member-history`
- `GET /v4/shadow/role-catalog`
- `GET /v4/shadow/scopes`

They require organization-scope `membership.manage`.

## Edge Function successor

Source: `supabase/functions/meicare-member-admin-v4/index.ts`

The successor does not directly mutate `organization_members`. It:

1. validates the human JWT;
2. validates invite role/scope through `validate_member_invite_v4`;
3. creates the Supabase Auth invitation with the service credential only inside the Edge Function;
4. registers the invited membership using the **same human JWT** and `register_invited_member_v4`;
5. compensates by deleting the newly-created Auth user if database registration fails;
6. routes status and role changes through governed V4 RPCs.

Production deployment should use `verify_jwt=true` and restricted allowed origins.

## UI

`web-shadow/member-admin.html` is a dedicated governance console rather than adding mutations to the read-only Shadow Worker. It supports:

- invite form with role/scope/department and mandatory reason;
- current member/status/role display;
- suspend / disable / reactivate;
- assign role;
- end role while retaining history;
- lifecycle audit timeline;
- responsive tablet/mobile layout.

The main Shadow dashboard only exposes the link when `session.capabilities.member_admin=true`.

## Release gate

This step changes authentication/authorization behavior and replaces the legacy member-admin write path. Under `.github/MEICARE_RELEASE_GATE.md`, it requires **Founder A approval before production deployment/application**.

Until that approval and production smoke evidence exist:

- do not apply `20260906030000_v4_009f_member_lifecycle.sql` to production;
- do not apply `20260906030100_v4_009f_member_admin_read_models.sql` to production;
- do not deploy `meicare-member-admin-v4` as a production replacement;
- keep the current `meicare-member-admin` production function unchanged;
- keep `frontend_v4_ready=false` and `cutover_stage=SHADOW`.

## Acceptance required before promotion

1. invite new user as Warehouse Staff scoped to Kho 1;
2. accept invite → membership becomes ACTIVE;
3. Warehouse Staff sees only Kho 1 inventory and one warehouse;
4. suspend → access disappears while role history remains;
5. reactivate suspended member → prior role resumes;
6. disable → current non-owner roles are ended;
7. reactivate disabled member → no role access until explicit reassignment;
8. current OWNER cannot be suspended/disabled;
9. Hospital Admin cannot grant OWNER;
10. every lifecycle/role write emits audit reason and actor lineage;
11. temporary test users/data are removed or transactionally rolled back;
12. inventory ledger drift remains zero.
