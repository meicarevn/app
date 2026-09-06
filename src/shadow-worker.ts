import { HttpError, requestId } from "./lib";
import { handleShadowRead } from "./shadow";

export interface ShadowEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SHADOW_ALLOWED_ORIGIN?: string;
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

function corsHeaders(req: Request, env: ShadowEnv) {
  const origin = req.headers.get("origin");
  const allowed = env.SHADOW_ALLOWED_ORIGIN?.trim();
  if (!origin || !allowed || origin !== allowed) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization,content-type,x-organization-id,x-request-id",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-max-age": "600",
    vary: "Origin"
  };
}

function json(req: Request, env: ShadowEnv, body: Json, status: number, rid: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": rid,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      ...corsHeaders(req, env)
    }
  });
}

export default {
  async fetch(req: Request, env: ShadowEnv): Promise<Response> {
    const rid = requestId(req);
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      const headers = corsHeaders(req, env);
      if (!("access-control-allow-origin" in headers)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers });
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(req, env, {
          status: "ok",
          service: "meicare-v4-shadow-read",
          mode: "SHADOW",
          read_only: true
        }, 200, rid);
      }

      if (url.pathname.startsWith("/v4/shadow/")) {
        const body = await handleShadowRead(req, env, rid) as Json;
        return json(req, env, body, 200, rid);
      }

      return json(req, env, { error: "NOT_FOUND", request_id: rid }, 404, rid);
    } catch (error) {
      if (error instanceof HttpError) {
        console.warn(JSON.stringify({ event: "shadow_rejected", code: error.code, status: error.status, request_id: rid }));
        return json(req, env, { error: error.code, request_id: rid }, error.status, rid);
      }
      console.error(JSON.stringify({ event: "shadow_unhandled_error", request_id: rid }));
      return json(req, env, { error: "SHADOW_GATEWAY_ERROR", request_id: rid }, 500, rid);
    }
  }
};
