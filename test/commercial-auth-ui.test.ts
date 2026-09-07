import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const login = readFileSync("web-shadow/login.js", "utf8");
const session = readFileSync("web-shadow/session.js", "utf8");
const app = readFileSync("web-shadow/app.js", "utf8");
const platform = readFileSync("web-platform/index.html", "utf8");
const route = readFileSync("shadow-pages/functions/v4/shadow/[[path]].ts", "utf8");

describe("V4_013 commercial authentication foundation", () => {
  it("does not hard-code a tenant or ask an operator to paste credentials", () => {
    expect(login).not.toContain("ORGANIZATION_ID");
    expect(platform).not.toContain("Supabase access token");
    expect(platform).not.toContain("Gateway URL");
    expect(platform).not.toMatch(/placeholder="UUID"/);
    expect(platform).toContain("Chọn bệnh viện");
  });

  it("resolves organizations from the authenticated RLS session", () => {
    expect(route).toContain('url.pathname === "/v4/shadow/organizations"');
    expect(route).toContain("listShadowOrganizations");
    expect(app).toContain("MEICARE_SESSION.organizations()");
    expect(app).toContain("MEICARE_SESSION.selectOrganization");
  });

  it("rotates refresh tokens and retries an expired access token once", () => {
    expect(session).toContain('authToken("refresh_token"');
    expect(session).toContain("if (response.status === 401 && retry");
    expect(session).toContain("authorizedFetch(input, init, false)");
    expect(session).toContain("logout?scope=local");
  });

  it("keeps service-role and secret credentials out of browser assets", () => {
    for (const source of [login, session, app, platform]) {
      expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role/i);
    }
  });
});
