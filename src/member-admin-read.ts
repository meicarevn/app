import { HttpError } from "./lib";

type Env = { SUPABASE_URL: string; SUPABASE_ANON_KEY: string };
type Row = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearer(req: Request) {
  const value = req.headers.get("authorization") || "";
  if (!value.startsWith("Bearer ")) throw new HttpError(401, "UNAUTHORIZED");
  return value.slice(7);
}

async function readView(
  req: Request,
  env: Env,
  rid: string,
  view: string,
  params: Record<string, string>
): Promise<Row[]> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${view}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${bearer(req)}`,
      accept: "application/json",
      "x-request-id": rid
    }
  });
  if (!res.ok) {
    console.error(JSON.stringify({ event: "member_admin_read_failed", view, status: res.status, request_id: rid }));
    throw new HttpError(res.status === 401 || res.status === 403 ? res.status : 502, "MEMBER_ADMIN_READ_FAILED");
  }
  return await res.json() as Row[];
}

export async function handleMemberAdminRead(req: Request, env: Env, rid: string, org: string) {
  if (req.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED");
  const url = new URL(req.url);

  if (url.pathname === "/v4/shadow/members") {
    return {
      mode: "SHADOW",
      kind: "members",
      organization_id: org,
      rows: await readView(req, env, rid, "member_admin_v4", {
        organization_id: `eq.${org}`,
        select: "*",
        order: "member_status.asc,display_name.asc.nullslast,email.asc.nullslast"
      })
    };
  }

  if (url.pathname === "/v4/shadow/member-history") {
    const membershipId = url.searchParams.get("membership_id")?.trim() || null;
    if (membershipId && !UUID_RE.test(membershipId)) throw new HttpError(400, "INVALID_MEMBERSHIP_ID");
    const params: Record<string, string> = {
      organization_id: `eq.${org}`,
      select: "*",
      order: "created_at.desc,audit_id.desc",
      limit: "200"
    };
    if (membershipId) params.membership_id = `eq.${membershipId}`;
    return {
      mode: "SHADOW",
      kind: "member_history",
      organization_id: org,
      rows: await readView(req, env, rid, "member_lifecycle_history_v4", params)
    };
  }

  if (url.pathname === "/v4/shadow/role-catalog") {
    return {
      mode: "SHADOW",
      kind: "role_catalog",
      organization_id: org,
      rows: await readView(req, env, rid, "member_role_scope_catalog_v4", {
        organization_id: `eq.${org}`,
        select: "*",
        order: "role_code.asc,scope_type.asc"
      })
    };
  }

  if (url.pathname === "/v4/shadow/scopes") {
    return {
      mode: "SHADOW",
      kind: "scope_targets",
      organization_id: org,
      rows: await readView(req, env, rid, "member_scope_targets_v4", {
        organization_id: `eq.${org}`,
        select: "*",
        order: "scope_type.asc,sort_order.asc,scope_name.asc"
      })
    };
  }

  throw new HttpError(404, "MEMBER_ADMIN_ROUTE_NOT_FOUND");
}
