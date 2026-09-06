import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/lib";
import { handleShadowRead } from "../src/shadow";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test-key"
};

const organizationId = "68d83220-4e5d-46e7-8bd3-7863205985f4";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("V4 shadow read contract", () => {
  it("rejects mutation methods before any upstream call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(`https://shadow.example/v4/shadow/readiness?organization_id=${organizationId}`, {
      method: "POST",
      headers: { authorization: "Bearer user-token" }
    });

    await expect(handleShadowRead(request, env, "rid-1")).rejects.toMatchObject({
      status: 405,
      code: "METHOD_NOT_ALLOWED"
    } satisfies Partial<HttpError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the user bearer token for RLS-aware PostgREST reads", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer user-token");
        return new Response(JSON.stringify({ id: "user-1" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/rest/v1/production_readiness_v4")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer user-token");
        expect(headers.get("apikey")).toBe("anon-test-key");
        expect(url).toContain(`organization_id=eq.${organizationId}`);
        return new Response(JSON.stringify([{ organization_id: organizationId, cutover_stage: "SHADOW", frontend_v4_ready: false }]), {
          status: 200,
          headers: { "content-type": "application/json", "content-range": "0-0/1" }
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request(`https://shadow.example/v4/shadow/readiness?organization_id=${organizationId}`, {
      headers: { authorization: "Bearer user-token" }
    });
    const result = await handleShadowRead(request, env, "rid-2") as Record<string, unknown>;

    expect(result.mode).toBe("SHADOW");
    expect(result.organization_id).toBe(organizationId);
    expect((result.readiness as Record<string, unknown>).frontend_v4_ready).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects requests without a user token", async () => {
    const request = new Request(`https://shadow.example/v4/shadow/readiness?organization_id=${organizationId}`);
    await expect(handleShadowRead(request, env, "rid-3")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED"
    } satisfies Partial<HttpError>);
  });

  it("rejects an invalid organization id after authenticating the user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "user-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));
    const request = new Request("https://shadow.example/v4/shadow/readiness?organization_id=not-a-uuid", {
      headers: { authorization: "Bearer user-token" }
    });
    await expect(handleShadowRead(request, env, "rid-4")).rejects.toMatchObject({
      status: 400,
      code: "ORGANIZATION_ID_REQUIRED"
    } satisfies Partial<HttpError>);
  });
});
