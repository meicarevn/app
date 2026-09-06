(() => {
  "use strict";
  const SUPABASE = "https://sgxufmcsnveyyddazwuk.supabase.co";
  const PUBLISHABLE = "sb_publishable_9xbWYiMtnriBmFwuiGp8Qw_FNTB8NFc";
  const state = { token: "", user: null, membership: null };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

  function status(message, kind = "") {
    const el = $("status"); el.textContent = message; el.className = `status ${kind}`.trim();
  }
  function authHeaders() {
    return { apikey: PUBLISHABLE, authorization: `Bearer ${state.token}`, accept: "application/json" };
  }
  async function get(path) {
    const res = await fetch(`${SUPABASE}${path}`, { headers: authHeaders(), cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `HTTP_${res.status}`);
    return body;
  }
  async function refresh() {
    if (!state.token || !state.user) throw new Error("AUTH_REQUIRED");
    const own = await get(`/rest/v1/organization_members?user_id=eq.${encodeURIComponent(state.user.id)}&status=eq.ACTIVE&select=id,organization_id,role,status,display_name,email&limit=10`);
    if (!Array.isArray(own) || !own.length) throw new Error("ACTIVE_MEMBERSHIP_NOT_FOUND");
    state.membership = own.find(x => x.role === "OWNER") || own[0];
    const org = state.membership.organization_id;
    const members = await get(`/rest/v1/organization_members?organization_id=eq.${encodeURIComponent(org)}&select=id,display_name,email,status,role&order=created_at.asc`);
    $("session").textContent = `Authenticated: ${state.user.email || state.user.id}\nOrganization: ${org}\nMembership: ${state.membership.id}\nRole: ${state.membership.role}\nStatus: ${state.membership.status}`;
    $("members").innerHTML = (members || []).map(m => `<tr><td>${esc(m.display_name || "—")}</td><td>${esc(m.email || "—")}</td><td>${esc(m.status)}</td><td>${esc(m.role)}</td></tr>`).join("") || `<tr><td colspan="4">Không có dữ liệu.</td></tr>`;
    $("acceptanceCard").hidden = false; $("membersCard").hidden = false;
    status("Đã xác thực. Canary write path sẵn sàng cho test fail-closed.", "ok");
  }

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault(); status("Đang xác thực…");
    const email = $("email").value.trim(); const password = $("password").value;
    try {
      const res = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: { apikey: PUBLISHABLE, "content-type": "application/json" },
        body: JSON.stringify({ email, password }), cache: "no-store"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.access_token || !body.user) throw new Error(body.error_description || body.msg || "AUTH_FAILED");
      state.token = body.access_token; state.user = body.user; $("password").value = "";
      await refresh();
    } catch (error) { state.token = ""; state.user = null; state.membership = null; status(error.message || String(error), "danger"); }
  });

  $("logout").addEventListener("click", () => {
    state.token = ""; state.user = null; state.membership = null; $("password").value = "";
    $("acceptanceCard").hidden = true; $("membersCard").hidden = true; status("Đã xoá session khỏi bộ nhớ tab.");
  });
  $("refresh").addEventListener("click", () => refresh().catch(e => status(e.message || String(e), "danger")));
  $("ownerProtection").addEventListener("click", async () => {
    if (!state.token || !state.membership) return status("AUTH_REQUIRED", "danger");
    if (state.membership.role !== "OWNER") return status("Test này chỉ áp dụng cho OWNER acceptance session.", "danger");
    status("Đang chạy OWNER protection test…");
    try {
      const res = await fetch("/api/member-admin", {
        method: "POST",
        headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json", "x-meicare-canary": "V4_009G", "x-request-id": crypto.randomUUID() },
        body: JSON.stringify({ action: "set_status", organization_id: state.membership.organization_id, membership_id: state.membership.id, status: "SUSPENDED", reason: "V4_009G controlled canary OWNER protection no-op test" }),
        cache: "no-store"
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.error === "MEMBER_STATUS_UPDATE_FAILED") {
        status("PASS: OWNER protection returned expected 409; no status mutation accepted.", "ok");
        await refresh();
        return;
      }
      status(`FAIL CLOSED: expected 409, received ${res.status} ${body.error || ""}. Stop canary; do not retry legacy.`, "danger");
    } catch (error) { status(`NETWORK/UPSTREAM FAILURE: ${error.message || error}. Stop canary; do not retry legacy.`, "danger"); }
  });
})();