import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const DEFAULT_SITE_URL = "https://meicare-smart-pharmacy.pages.dev";
const ALLOWED_STATUSES = new Set(["ACTIVE", "SUSPENDED", "DISABLED"]);
const SCOPE_TYPES = new Set(["ORGANIZATION", "ORG_UNIT", "WAREHOUSE"]);

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function secretKey() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("SUPABASE_SECRET_KEY_UNAVAILABLE");
  return legacy;
}

function allowedOrigin(request: Request) {
  const origin = request.headers.get("Origin") || "";
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || Deno.env.get("SITE_URL") || DEFAULT_SITE_URL)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origin) return configured[0] || DEFAULT_SITE_URL;
  return configured.includes(origin) ? origin : "";
}

function response(request: Request, body: unknown, status = 200) {
  const origin = allowedOrigin(request);
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type, x-request-id";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizeScope(payload: Record<string, unknown>) {
  const scopeType = cleanText(payload.scope_type, 32).toUpperCase() || "ORGANIZATION";
  const scopeId = cleanText(payload.scope_id, 64) || null;
  if (!SCOPE_TYPES.has(scopeType)) throw new Error("SCOPE_TYPE_INVALID");
  if (scopeType === "ORGANIZATION" && scopeId) throw new Error("ORGANIZATION_SCOPE_ID_MUST_BE_NULL");
  if (scopeType !== "ORGANIZATION" && !scopeId) throw new Error("SCOPE_ID_REQUIRED");
  return { scopeType, scopeId };
}

Deno.serve(async (request: Request) => {
  const requestId = request.headers.get("X-Request-Id") || crypto.randomUUID();
  if (request.method === "OPTIONS") {
    if (!allowedOrigin(request)) return response(request, { error: "ORIGIN_NOT_ALLOWED", request_id: requestId }, 403);
    return response(request, { ok: true, request_id: requestId });
  }
  if (request.method !== "POST") return response(request, { error: "METHOD_NOT_ALLOWED", request_id: requestId }, 405);
  if (!allowedOrigin(request)) return response(request, { error: "ORIGIN_NOT_ALLOWED", request_id: requestId }, 403);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return response(request, { error: "AUTH_REQUIRED", request_id: requestId }, 401);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anonKey) throw new Error("SUPABASE_RUNTIME_CONFIG_UNAVAILABLE");

    const token = authorization.slice(7);
    const admin = createClient(url, secretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization, "X-Request-Id": requestId } },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) {
      return response(request, { error: "AUTH_INVALID", request_id: requestId }, 401);
    }

    const payload = await request.json() as Record<string, unknown>;
    const action = cleanText(payload.action, 32).toLowerCase();
    const organizationId = cleanText(payload.organization_id, 64);
    if (!organizationId) {
      return response(request, { error: "ORGANIZATION_REQUIRED", request_id: requestId }, 422);
    }

    if (action === "invite") {
      const email = cleanText(payload.email, 254).toLowerCase();
      const displayName = cleanText(payload.display_name, 160);
      const roleCode = cleanText(payload.role_code, 64).toUpperCase();
      const departmentId = cleanText(payload.department_id, 64) || null;
      const reason = cleanText(payload.reason, 1000);
      const { scopeType, scopeId } = normalizeScope(payload);

      if (!/^\S+@\S+\.\S+$/.test(email)) return response(request, { error: "EMAIL_INVALID", request_id: requestId }, 422);
      if (!displayName) return response(request, { error: "DISPLAY_NAME_REQUIRED", request_id: requestId }, 422);
      if (!roleCode) return response(request, { error: "ROLE_REQUIRED", request_id: requestId }, 422);
      if (!reason) return response(request, { error: "AUDIT_REASON_REQUIRED", request_id: requestId }, 422);

      const { error: validationError } = await userClient.rpc("validate_member_invite_v4", {
        p_organization_id: organizationId,
        p_role_code: roleCode,
        p_scope_type: scopeType,
        p_scope_id: scopeId,
        p_department_id: departmentId,
      });
      if (validationError) {
        console.warn("Member invite validation rejected", { requestId, code: validationError.code });
        return response(request, { error: "INVITE_VALIDATION_FAILED", request_id: requestId }, 403);
      }

      const siteUrl = Deno.env.get("SITE_URL") || DEFAULT_SITE_URL;
      const redirect = new URL("/auth/callback", siteUrl);
      redirect.searchParams.set("member_invite", "1");

      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: displayName },
        redirectTo: redirect.toString(),
      });
      if (inviteError || !invited.user) {
        const alreadyRegistered = /already|registered|exists/i.test(inviteError?.message || "");
        console.warn("Auth invite failed", { requestId, alreadyRegistered });
        return response(request, {
          error: alreadyRegistered ? "EMAIL_ALREADY_REGISTERED" : "INVITE_DELIVERY_FAILED",
          request_id: requestId,
        }, alreadyRegistered ? 409 : 400);
      }

      const { data: registration, error: registrationError } = await userClient.rpc("register_invited_member_v4", {
        p_organization_id: organizationId,
        p_user_id: invited.user.id,
        p_email: email,
        p_display_name: displayName,
        p_role_code: roleCode,
        p_scope_type: scopeType,
        p_scope_id: scopeId,
        p_department_id: departmentId,
        p_reason: reason,
      });

      if (registrationError) {
        console.error("Membership registration failed; compensating Auth invite", {
          requestId,
          code: registrationError.code,
        });
        const { error: cleanupError } = await admin.auth.admin.deleteUser(invited.user.id);
        if (cleanupError) console.error("Auth invite compensation failed", { requestId, code: cleanupError.code });
        return response(request, { error: "MEMBERSHIP_REGISTRATION_FAILED", request_id: requestId }, 409);
      }

      return response(request, { status: "INVITED", registration, request_id: requestId }, 201);
    }

    if (action === "set_status") {
      const membershipId = cleanText(payload.membership_id, 64);
      const status = cleanText(payload.status, 32).toUpperCase();
      const reason = cleanText(payload.reason, 1000);
      if (!membershipId) return response(request, { error: "MEMBERSHIP_REQUIRED", request_id: requestId }, 422);
      if (!ALLOWED_STATUSES.has(status)) return response(request, { error: "STATUS_INVALID", request_id: requestId }, 422);
      if (!reason) return response(request, { error: "AUDIT_REASON_REQUIRED", request_id: requestId }, 422);

      const { data, error } = await userClient.rpc("set_member_status_v4", {
        p_organization_id: organizationId,
        p_membership_id: membershipId,
        p_status: status,
        p_reason: reason,
      });
      if (error) {
        console.warn("Member status update rejected", { requestId, code: error.code });
        return response(request, { error: "MEMBER_STATUS_UPDATE_FAILED", request_id: requestId }, 409);
      }
      return response(request, { result: data, request_id: requestId });
    }

    if (action === "assign_role") {
      const membershipId = cleanText(payload.membership_id, 64);
      const roleCode = cleanText(payload.role_code, 64).toUpperCase();
      const reason = cleanText(payload.reason, 1000);
      const { scopeType, scopeId } = normalizeScope(payload);
      if (!membershipId || !roleCode || !reason) {
        return response(request, { error: "ROLE_ASSIGNMENT_INPUT_INVALID", request_id: requestId }, 422);
      }
      const { data, error } = await userClient.rpc("assign_membership_role_v4", {
        p_organization_id: organizationId,
        p_membership_id: membershipId,
        p_role_code: roleCode,
        p_scope_type: scopeType,
        p_scope_id: scopeId,
        p_valid_from: null,
        p_valid_to: null,
        p_reason: reason,
      });
      if (error) {
        console.warn("Role assignment rejected", { requestId, code: error.code });
        return response(request, { error: "ROLE_ASSIGNMENT_FAILED", request_id: requestId }, 409);
      }
      return response(request, { assignment_id: data, request_id: requestId }, 201);
    }

    if (action === "end_role") {
      const assignmentId = cleanText(payload.assignment_id, 64);
      const reason = cleanText(payload.reason, 1000);
      if (!assignmentId || !reason) {
        return response(request, { error: "ROLE_END_INPUT_INVALID", request_id: requestId }, 422);
      }
      const { data, error } = await userClient.rpc("end_membership_role_v4", {
        p_organization_id: organizationId,
        p_assignment_id: assignmentId,
        p_end_at: null,
        p_reason: reason,
      });
      if (error) {
        console.warn("Role ending rejected", { requestId, code: error.code });
        return response(request, { error: "ROLE_END_FAILED", request_id: requestId }, 409);
      }
      return response(request, { assignment_id: data, request_id: requestId });
    }

    return response(request, { error: "ACTION_INVALID", request_id: requestId }, 422);
  } catch (error) {
    console.error("V4 member administration failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return response(request, { error: "MEMBER_ADMIN_V4_FAILED", request_id: requestId }, 500);
  }
});
