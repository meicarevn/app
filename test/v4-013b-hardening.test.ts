import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("web-shadow/app.js", "utf8");
const login = readFileSync("web-shadow/login.js", "utf8");
const session = readFileSync("web-shadow/session.js", "utf8");
const styles = readFileSync("web-shadow/styles.css", "utf8");
const roleUx = readFileSync("web-shadow/role-ux.css", "utf8");
const headers = readFileSync("web-platform/_headers", "utf8");
const notFound = readFileSync("web-shadow/404.html", "utf8");
const workflow = readFileSync(".github/workflows/v4-013-commercial-readiness.yml", "utf8");

const functionSources = [
  "shadow-pages/functions/v4/shadow/[[path]].ts",
  "shadow-pages/functions/v4/shadow/intelligence-v4-011.ts",
  "shadow-pages/functions/v4/shadow/intelligence-v4-011-canary.ts"
].map((path) => readFileSync(path, "utf8"));

const requiredHeaders = [
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy"
];

describe("V4_013B frontend hardening", () => {
  it("protects static assets with restrictive preview headers", () => {
    for (const header of requiredHeaders) expect(headers.toLowerCase()).toContain(header);
    expect(headers).toContain("X-Robots-Tag: noindex, nofollow");
    expect(headers).toContain("Cache-Control: private, no-store");
  });

  it("sets security headers explicitly on every Pages Function response", () => {
    for (const source of functionSources) {
      for (const header of requiredHeaders) expect(source).toContain(`\"${header}\"`);
      expect(source).toContain('"cache-control": "no-store"');
    }
  });

  it("recovers from session and network failures without erasing rendered data", () => {
    expect(session).toContain('new CustomEvent("meicare:session-expired")');
    expect(session).toContain('window.addEventListener("offline", updateNetworkStatus)');
    expect(session).toContain('["AUTH_INVALID_CREDENTIALS", "AUTH_401", "AUTH_403"].includes');
    expect(login).toContain('reason === "session_expired"');
    expect(app).toContain("if (!hasRenderedView) root.innerHTML = empty()");
    expect(app).toContain('data-error-action="retry"');
    expect(app).toMatch(/failed to fetch\|networkerror\|load failed/i);
  });

  it("keeps core controls usable on tablet and phone", () => {
    expect(styles).toContain("@media (max-width: 760px)");
    expect(roleUx).toContain("@media (max-width: 1100px)");
    expect(roleUx).not.toMatch(/#connectionButton\s*\{[^}]*display:\s*none/s);
    expect(roleUx).toContain(":focus-visible");
    expect(roleUx).toContain("prefers-reduced-motion: reduce");
  });

  it("ships and validates a branded 404 plus rollback isolation evidence", () => {
    expect(notFound).toContain("Không tìm thấy trang");
    expect(notFound).toContain('meta name="robots" content="noindex,nofollow"');
    expect(workflow).toContain('wait_for "route fallback"');
    expect(workflow).toContain("ROLLBACK_URL");
    expect(workflow).toContain("Rollback isolation evidence");
  });
});
