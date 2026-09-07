import { handleShadowRead } from "../../../../src/shadow";
import { handleMemberAdminRead } from "../../../../src/member-admin-read";
import {
  getShadowAccess,
  enforceShadowRoute,
  listShadowOrganizations,
  shadowOrganizationId
} from "../../../../src/shadow-access";
import { HttpError, requestId } from "../../../../src/lib";

type Env = Record<string, never>;
type PagesContext = { request: Request; env: Env };
type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

const SHADOW_ENV = {
  SUPABASE_URL: "https://sgxufmcsnveyyddazwuk.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_9xbWYiMtnriBmFwuiGp8Qw_FNTB8NFc"
};

const MEMBER_ADMIN_PATHS = new Set([
  "/v4/shadow/members",
  "/v4/shadow/member-history",
  "/v4/shadow/role-catalog",
  "/v4/shadow/scopes"
]);

function json(body: Json, status: number, rid: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-request-id": rid
    }
  });
}

async function handle(context: PagesContext) {
  const req = context.request;
  const rid = requestId(req);

  try {
    if (req.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED");

    const url = new URL(req.url);
    if (url.pathname === "/v4/shadow/organizations") {
      const organizations = await listShadowOrganizations(req, SHADOW_ENV, rid);
      return json({ organizations }, 200, rid);
    }

    const org = shadowOrganizationId(req, url);
    const access = await getShadowAccess(req, SHADOW_ENV, rid, org);

    if (url.pathname === "/v4/shadow/session") {
      return json({
        mode: "SHADOW",
        read_only: true,
        ...access
      }, 200, rid);
    }

    enforceShadowRoute(url.pathname, access);

    const body = MEMBER_ADMIN_PATHS.has(url.pathname)
      ? await handleMemberAdminRead(req, SHADOW_ENV, rid, org) as Json
      : await handleShadowRead(req, SHADOW_ENV, rid) as Json;

    return json(body, 200, rid);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.code, request_id: rid }, error.status, rid);
    }
    console.error(JSON.stringify({ event: "v4_010_shadow_preview_failed", request_id: rid }));
    return json({ error: "SHADOW_PREVIEW_FAILED", request_id: rid }, 500, rid);
  }
}

export const onRequest = handle;
