(() => {
  "use strict";

  const boot = window.MEICARE_SHADOW_CONFIG || {};
  const SUPABASE_ORIGIN = "https://sgxufmcsnveyyddazwuk.supabase.co";
  const APPROVED_V4_PATH = "/functions/v1/meicare-member-admin-v4";
  const state = {
    gateway: boot.gatewayUrl || sessionStorage.getItem("meicare.shadow.gateway") || "",
    organizationId: boot.organizationId || sessionStorage.getItem("meicare.shadow.organization") || "",
    token: boot.accessToken || sessionStorage.getItem("meicare.shadow.token") || "",
    mode: String(boot.memberAdminMode || sessionStorage.getItem("meicare.memberAdmin.mode") || "OFF").trim().toUpperCase(),
    memberAdminUrl: boot.memberAdminFunctionUrl || sessionStorage.getItem("meicare.memberAdmin.functionUrl") || `${SUPABASE_ORIGIN}${APPROVED_V4_PATH}`,
    legacyUrl: boot.legacyMemberAdminUrl || "",
    members: [], roles: [], scopes: [], history: [], action: null,
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function approvedEndpoint() {
    try {
      const url = new URL(state.memberAdminUrl);
      return url.protocol === "https:" && url.origin === SUPABASE_ORIGIN && url.pathname === APPROVED_V4_PATH && !url.search && !url.hash;
    } catch { return false; }
  }

  function canaryEnabled() { return state.mode === "V4_CANARY" && approvedEndpoint(); }

  function canaryReason() {
    if (state.mode !== "V4_CANARY") return "FLAG_OFF";
    if (!approvedEndpoint()) return "ENDPOINT_NOT_APPROVED";
    return "ENABLED";
  }

  function showNotice(kind, message) {
    const ok = $("adminSuccess"); const err = $("adminError");
    ok.hidden = true; err.hidden = true;
    const target = kind === "success" ? ok : err;
    target.innerHTML = `<strong>${kind === "success" ? "Hoàn tất" : "Không thực hiện được"}</strong><span>${esc(message)}</span>`;
    target.hidden = false;
  }

  function dateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? esc(value) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function statusPill(status) {
    const value = String(status || "UNKNOWN");
    const cls = value === "ACTIVE" ? "success" : value === "SUSPENDED" || value === "INVITED" ? "warning" : value === "DISABLED" ? "danger" : "info";
    return `<span class="status-pill ${cls}">${esc(value)}</span>`;
  }

  function setCanaryUi() {
    const enabled = canaryEnabled();
    const notice = $("releaseGateNotice");
    const mode = $("memberAdminCanaryMode");
    const route = $("memberAdminCanaryRoute");
    if (mode) mode.textContent = enabled ? "V4 CANARY · ENABLED" : `V4 CANARY · ${canaryReason()}`;
    if (route) route.textContent = enabled ? "Write path: meicare-member-admin-v4" : "Write path: disabled; legacy UI remains rollback path";
    notice.classList.toggle("warning", !enabled);
    notice.classList.toggle("success", enabled);
    notice.innerHTML = enabled
      ? "<strong>Canary V4 đang bật cho phiên này.</strong><span>Mọi write chỉ đi tới meicare-member-admin-v4; không có fallback im lặng sang legacy.</span>"
      : "<strong>V4 member-admin canary đang tắt.</strong><span>Giao diện chỉ đọc. Legacy production member-admin vẫn là rollback path; bật canary phải dùng cấu hình rõ ràng V4_CANARY.</span>";
    document.querySelectorAll("#inviteForm input, #inviteForm select, #inviteForm textarea, #inviteForm button").forEach((node) => { node.disabled = !enabled; });
  }

  async function shadowGet(path, params = {}) {
    if (!state.gateway || !state.organizationId || !state.token) throw new Error("SHADOW_CONNECTION_REQUIRED");
    const url = new URL(`${state.gateway.replace(/\/+$/, "")}${path}`);
    url.searchParams.set("organization_id", state.organizationId);
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, String(value));
    const res = await fetch(url, { method: "GET", headers: { authorization: `Bearer ${state.token}`, "x-organization-id": state.organizationId, "x-request-id": crypto.randomUUID() }, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP_${res.status}`);
    return body;
  }

  function friendlyWriteError(status, code) {
    if (status === 401) return "Phiên đăng nhập không còn hợp lệ. Hãy đăng nhập lại trước khi quản trị thành viên.";
    if (status === 403) return "Tài khoản hiện tại không có quyền membership.manage ở phạm vi toàn bệnh viện.";
    if (status === 409) return code || "Thao tác xung đột với trạng thái/role hiện tại.";
    if (status >= 500) return "Member Admin V4 tạm thời không khả dụng; không chuyển sang legacy tự động.";
    return code || `HTTP_${status}`;
  }

  async function governedWrite(action, payload) {
    if (!canaryEnabled()) throw new Error(canaryReason() === "FLAG_OFF" ? "MEMBER_ADMIN_V4_CANARY_DISABLED" : "MEMBER_ADMIN_V4_ENDPOINT_NOT_APPROVED");
    if (!state.token || !state.organizationId) throw new Error("AUTH_REQUIRED");
    const res = await fetch(state.memberAdminUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json", "x-request-id": crypto.randomUUID(), "x-meicare-canary": "V4_009G" },
      body: JSON.stringify({ action, organization_id: state.organizationId, ...payload }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(friendlyWriteError(res.status, body.error));
    return body;
  }

  function uniqueRoles() {
    const seen = new Map();
    for (const row of state.roles) if (row.role_code !== "OWNER" && !seen.has(row.role_code)) seen.set(row.role_code, row);
    return [...seen.values()];
  }
  const roleScopeTypes = (roleCode) => state.roles.filter((row) => row.role_code === roleCode).map((row) => row.scope_type);
  const departments = () => state.scopes.filter((row) => row.scope_type === "ORG_UNIT");

  function populateRoleSelect(select, selected) {
    select.innerHTML = uniqueRoles().map((row) => `<option value="${esc(row.role_code)}"${row.role_code === selected ? " selected" : ""}>${esc(row.role_name)} · ${esc(row.role_code)}</option>`).join("");
  }
  function populateScopeTypes(roleCode, select, selected) {
    select.innerHTML = roleScopeTypes(roleCode).map((scope) => `<option value="${esc(scope)}"${scope === selected ? " selected" : ""}>${esc(scope)}</option>`).join("");
  }
  function populateScopeTargets(scopeType, select, label) {
    const visible = scopeType !== "ORGANIZATION";
    label.hidden = !visible;
    if (!visible) { select.innerHTML = ""; return; }
    select.innerHTML = state.scopes.filter((row) => row.scope_type === scopeType).map((row) => `<option value="${esc(row.scope_id)}">${esc(row.scope_code)} · ${esc(row.scope_name)}</option>`).join("");
  }

  function refreshInviteControls() {
    const role = $("inviteRole"); const type = $("inviteScopeType");
    populateScopeTypes(role.value, type, type.value);
    populateScopeTargets(type.value, $("inviteScopeId"), $("inviteScopeTargetLabel"));
  }

  function renderMembers() {
    const enabled = canaryEnabled();
    const counts = state.members.reduce((acc, row) => { acc[row.member_status] = (acc[row.member_status] || 0) + 1; return acc; }, {});
    $("memberSummary").innerHTML = Object.entries(counts).map(([key, value]) => `<span class="summary-token">${esc(key)} · ${value}</span>`).join("");
    $("membersBody").innerHTML = state.members.map((member) => {
      const roles = Array.isArray(member.current_roles) ? member.current_roles : [];
      const roleHtml = roles.length ? roles.map((role) => `<span class="role-token">${esc(role.role_code)} · ${esc(role.scope_type)}${enabled ? `<button class="icon-button" data-action="end-role" data-member="${esc(member.membership_id)}" data-assignment="${esc(role.assignment_id)}" type="button" aria-label="Kết thúc role">×</button>` : ""}</span>`).join("") : `<span class="muted-small">Chưa có role hiệu lực</span>`;
      const actions = [];
      if (enabled && ["ACTIVE", "INVITED"].includes(member.member_status)) actions.push(`<button class="secondary-button" data-action="assign-role" data-member="${esc(member.membership_id)}" type="button">+ Role</button>`);
      if (enabled && member.member_status === "ACTIVE") actions.push(`<button class="secondary-button" data-action="status" data-status="SUSPENDED" data-member="${esc(member.membership_id)}" type="button">Tạm khoá</button>`, `<button class="secondary-button" data-action="status" data-status="DISABLED" data-member="${esc(member.membership_id)}" type="button">Vô hiệu</button>`);
      if (enabled && member.member_status === "SUSPENDED") actions.push(`<button class="secondary-button" data-action="status" data-status="ACTIVE" data-member="${esc(member.membership_id)}" type="button">Mở lại</button>`);
      if (enabled && member.member_status === "DISABLED") actions.push(`<button class="secondary-button" data-action="status" data-status="ACTIVE" data-member="${esc(member.membership_id)}" type="button">Kích hoạt lại</button>`);
      return `<tr><td><div class="member-name"><strong>${esc(member.display_name || "Chưa đặt tên")}</strong><span>${esc(member.email || "—")}</span><span>${esc(member.department_name || "Không gán bộ phận")}</span></div></td><td>${statusPill(member.member_status)}</td><td><div class="role-stack">${roleHtml}</div></td><td><div class="muted-small">${dateTime(member.status_changed_at)}</div><div class="muted-small">${esc(member.status_reason || "—")}</div></td><td><div class="member-actions">${actions.join("") || "<span class=\"muted-small\">Read only</span>"}</div></td></tr>`;
    }).join("") || `<tr><td colspan="5"><div class="empty-state">Chưa có thành viên.</div></td></tr>`;
  }

  function renderHistory() {
    $("historyList").innerHTML = state.history.slice(0, 80).map((item) => `<div class="history-item"><time>${dateTime(item.created_at)}</time><strong class="history-action">${esc(item.action)}</strong><span class="history-reason">${esc(item.reason || "Không ghi lý do")}</span></div>`).join("") || `<div class="empty-state">Chưa có lifecycle audit.</div>`;
  }

  async function load() {
    setCanaryUi();
    try {
      const [members, roles, scopes, history] = await Promise.all([shadowGet("/v4/shadow/members"), shadowGet("/v4/shadow/role-catalog"), shadowGet("/v4/shadow/scopes"), shadowGet("/v4/shadow/member-history")]);
      state.members = members.rows || []; state.roles = roles.rows || []; state.scopes = scopes.rows || []; state.history = history.rows || [];
      populateRoleSelect($("inviteRole")); refreshInviteControls();
      $("inviteDepartment").innerHTML = `<option value="">Không gán bộ phận</option>` + departments().map((row) => `<option value="${esc(row.scope_id)}">${esc(row.scope_code)} · ${esc(row.scope_name)}</option>`).join("");
      renderMembers(); renderHistory(); setCanaryUi();
    } catch (error) { showNotice("error", error?.message || error); }
  }

  $("inviteRole").addEventListener("change", refreshInviteControls);
  $("inviteScopeType").addEventListener("change", () => populateScopeTargets($("inviteScopeType").value, $("inviteScopeId"), $("inviteScopeTargetLabel")));
  $("inviteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await governedWrite("invite", { email: $("inviteEmail").value.trim(), display_name: $("inviteName").value.trim(), role_code: $("inviteRole").value, scope_type: $("inviteScopeType").value, scope_id: $("inviteScopeType").value === "ORGANIZATION" ? null : $("inviteScopeId").value, department_id: $("inviteDepartment").value || null, reason: $("inviteReason").value.trim() });
      $("inviteForm").reset(); showNotice("success", "Đã tạo lời mời V4 ở trạng thái INVITED."); await load();
    } catch (error) { showNotice("error", error?.message || error); }
  });

  function openAction(action, memberId, extra = {}) {
    if (!canaryEnabled()) { showNotice("error", "MEMBER_ADMIN_V4_CANARY_DISABLED"); return; }
    const member = state.members.find((row) => row.membership_id === memberId);
    state.action = { action, memberId, ...extra }; $("actionReason").value = "";
    $("roleActionFields").hidden = action !== "assign-role";
    if (action === "assign-role") {
      $("actionTitle").textContent = `Gán role · ${member?.display_name || "thành viên"}`;
      populateRoleSelect($("actionRole")); populateScopeTypes($("actionRole").value, $("actionScopeType")); populateScopeTargets($("actionScopeType").value, $("actionScopeId"), $("actionScopeTargetLabel"));
    } else $("actionTitle").textContent = action === "end-role" ? `Kết thúc role · ${member?.display_name || "thành viên"}` : `${extra.status} · ${member?.display_name || "thành viên"}`;
    $("actionDescription").textContent = "Canary write được gửi duy nhất tới governed V4 endpoint và yêu cầu audit reason.";
    $("memberActionDialog").showModal();
  }

  $("membersBody").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]"); if (!button) return;
    openAction(button.dataset.action, button.dataset.member, { status: button.dataset.status, assignmentId: button.dataset.assignment });
  });
  $("actionRole").addEventListener("change", () => { populateScopeTypes($("actionRole").value, $("actionScopeType")); populateScopeTargets($("actionScopeType").value, $("actionScopeId"), $("actionScopeTargetLabel")); });
  $("actionScopeType").addEventListener("change", () => populateScopeTargets($("actionScopeType").value, $("actionScopeId"), $("actionScopeTargetLabel")));
  $("confirmMemberAction").addEventListener("click", async () => {
    if (!state.action) return;
    const reason = $("actionReason").value.trim(); if (reason.length < 3) { showNotice("error", "Cần nhập lý do audit tối thiểu 3 ký tự."); return; }
    try {
      if (state.action.action === "assign-role") await governedWrite("assign_role", { membership_id: state.action.memberId, role_code: $("actionRole").value, scope_type: $("actionScopeType").value, scope_id: $("actionScopeType").value === "ORGANIZATION" ? null : $("actionScopeId").value, reason });
      else if (state.action.action === "end-role") await governedWrite("end_role", { assignment_id: state.action.assignmentId, reason });
      else await governedWrite("set_status", { membership_id: state.action.memberId, status: state.action.status, reason });
      $("memberActionDialog").close(); state.action = null; showNotice("success", "Canary write đã hoàn tất qua V4."); await load();
    } catch (error) { showNotice("error", error?.message || error); }
  });

  $("refreshMembers").addEventListener("click", load);
  load();
})();
