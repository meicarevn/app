(() => {
  "use strict";

  const boot = window.MEICARE_SHADOW_CONFIG || {};
  const state = {
    gateway: boot.gatewayUrl || sessionStorage.getItem("meicare.shadow.gateway") || "",
    organizationId: boot.organizationId || sessionStorage.getItem("meicare.shadow.organization") || "",
    token: boot.accessToken || sessionStorage.getItem("meicare.shadow.token") || "",
    memberAdminUrl: boot.memberAdminFunctionUrl || sessionStorage.getItem("meicare.memberAdmin.functionUrl") || "https://sgxufmcsnveyyddazwuk.supabase.co/functions/v1/meicare-member-admin-v4",
    members: [], roles: [], scopes: [], history: [], action: null
  };

  const $ = (id) => document.getElementById(id);
  const membersBody = $("membersBody");
  const historyList = $("historyList");
  const inviteForm = $("inviteForm");
  const inviteRole = $("inviteRole");
  const inviteScopeType = $("inviteScopeType");
  const inviteScopeId = $("inviteScopeId");
  const inviteScopeTargetLabel = $("inviteScopeTargetLabel");
  const inviteDepartment = $("inviteDepartment");
  const dialog = $("memberActionDialog");
  const actionRole = $("actionRole");
  const actionScopeType = $("actionScopeType");
  const actionScopeId = $("actionScopeId");
  const actionScopeTargetLabel = $("actionScopeTargetLabel");

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
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

  function configured() { return Boolean(state.gateway && state.organizationId && state.token); }

  async function shadowGet(path, params = {}) {
    if (!configured()) throw new Error("SHADOW_CONNECTION_REQUIRED");
    const url = new URL(`${state.gateway.replace(/\/+$/, "")}${path}`);
    url.searchParams.set("organization_id", state.organizationId);
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, String(value));
    const res = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${state.token}`, "x-organization-id": state.organizationId, "x-request-id": crypto.randomUUID() },
      cache: "no-store"
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP_${res.status}`);
    return body;
  }

  async function governedWrite(action, payload) {
    if (!state.token || !state.organizationId) throw new Error("AUTH_REQUIRED");
    const res = await fetch(state.memberAdminUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json", "x-request-id": crypto.randomUUID() },
      body: JSON.stringify({ action, organization_id: state.organizationId, ...payload })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP_${res.status}`);
    return body;
  }

  function showNotice(kind, message) {
    const ok = $("adminSuccess"); const err = $("adminError");
    ok.hidden = true; err.hidden = true;
    const target = kind === "success" ? ok : err;
    target.innerHTML = `<strong>${kind === "success" ? "Hoàn tất" : "Không thực hiện được"}</strong><span>${esc(message)}</span>`;
    target.hidden = false;
  }

  function uniqueRoles() {
    const seen = new Map();
    for (const row of state.roles) if (!seen.has(row.role_code)) seen.set(row.role_code, row);
    return [...seen.values()].filter((row) => row.role_code !== "OWNER");
  }

  function roleScopeTypes(roleCode) {
    return state.roles.filter((row) => row.role_code === roleCode).map((row) => row.scope_type);
  }

  function populateRoleSelect(select, selected) {
    select.innerHTML = uniqueRoles().map((row) => `<option value="${esc(row.role_code)}"${row.role_code === selected ? " selected" : ""}>${esc(row.role_name)} · ${esc(row.role_code)}</option>`).join("");
  }

  function populateScopeTypes(roleCode, select, selected) {
    const allowed = roleScopeTypes(roleCode);
    select.innerHTML = allowed.map((scope) => `<option value="${esc(scope)}"${scope === selected ? " selected" : ""}>${esc(scope)}</option>`).join("");
  }

  function populateScopeTargets(scopeType, select, label) {
    const visible = scopeType !== "ORGANIZATION";
    label.hidden = !visible;
    if (!visible) { select.innerHTML = ""; return; }
    const rows = state.scopes.filter((row) => row.scope_type === scopeType);
    select.innerHTML = rows.map((row) => `<option value="${esc(row.scope_id)}">${esc(row.scope_code)} · ${esc(row.scope_name)}</option>`).join("");
  }

  function departments() { return state.scopes.filter((row) => row.scope_type === "ORG_UNIT"); }

  function refreshInviteControls() {
    populateScopeTypes(inviteRole.value, inviteScopeType, inviteScopeType.value);
    populateScopeTargets(inviteScopeType.value, inviteScopeId, inviteScopeTargetLabel);
  }

  function renderMembers() {
    const counts = state.members.reduce((acc, row) => { acc[row.member_status] = (acc[row.member_status] || 0) + 1; return acc; }, {});
    $("memberSummary").innerHTML = Object.entries(counts).map(([key, value]) => `<span class="summary-token">${esc(key)} · ${value}</span>`).join("");
    membersBody.innerHTML = state.members.map((member) => {
      const roles = Array.isArray(member.current_roles) ? member.current_roles : [];
      const roleHtml = roles.length ? roles.map((role) => `<span class="role-token">${esc(role.role_code)} · ${esc(role.scope_type)}${role.scope_id ? ` · ${esc(String(role.scope_id).slice(0, 8))}…` : ""}<button class="icon-button end-role-button" type="button" data-action="end-role" data-member="${esc(member.membership_id)}" data-assignment="${esc(role.assignment_id)}" aria-label="Kết thúc role ${esc(role.role_code)}">×</button></span>`).join("") : `<span class="muted-small">Chưa có role hiệu lực</span>`;
      const actions = [];
      if (["ACTIVE", "INVITED"].includes(member.member_status)) actions.push(`<button class="secondary-button" data-action="assign-role" data-member="${esc(member.membership_id)}" type="button">+ Role</button>`);
      if (member.member_status === "ACTIVE") actions.push(`<button class="secondary-button" data-action="status" data-status="SUSPENDED" data-member="${esc(member.membership_id)}" type="button">Tạm khoá</button>`, `<button class="secondary-button" data-action="status" data-status="DISABLED" data-member="${esc(member.membership_id)}" type="button">Vô hiệu</button>`);
      if (member.member_status === "SUSPENDED") actions.push(`<button class="secondary-button" data-action="status" data-status="ACTIVE" data-member="${esc(member.membership_id)}" type="button">Mở lại</button>`, `<button class="secondary-button" data-action="status" data-status="DISABLED" data-member="${esc(member.membership_id)}" type="button">Vô hiệu</button>`);
      if (member.member_status === "DISABLED") actions.push(`<button class="secondary-button" data-action="status" data-status="ACTIVE" data-member="${esc(member.membership_id)}" type="button">Kích hoạt lại</button>`);
      if (member.member_status === "INVITED") actions.push(`<button class="secondary-button" data-action="status" data-status="DISABLED" data-member="${esc(member.membership_id)}" type="button">Huỷ quyền truy cập</button>`);
      return `<tr><td><div class="member-name"><strong>${esc(member.display_name || "Chưa đặt tên")}</strong><span>${esc(member.email || "—")}</span><span>${esc(member.department_name || "Không gán bộ phận")}</span></div></td><td>${statusPill(member.member_status)}</td><td><div class="role-stack">${roleHtml}</div></td><td><div class="muted-small">${dateTime(member.status_changed_at)}</div><div class="muted-small">${esc(member.status_reason || "—")}</div></td><td><div class="member-actions">${actions.join("")}</div></td></tr>`;
    }).join("") || `<tr><td colspan="5"><div class="empty-state">Chưa có thành viên.</div></td></tr>`;
  }

  function renderHistory() {
    historyList.innerHTML = state.history.slice(0, 80).map((item) => `<div class="history-item"><time>${dateTime(item.created_at)}</time><strong class="history-action">${esc(item.action)}</strong><span class="history-reason">${esc(item.reason || "Không ghi lý do")}</span></div>`).join("") || `<div class="empty-state">Chưa có lifecycle audit.</div>`;
  }

  async function load() {
    try {
      const [members, roles, scopes, history] = await Promise.all([
        shadowGet("/v4/shadow/members"), shadowGet("/v4/shadow/role-catalog"), shadowGet("/v4/shadow/scopes"), shadowGet("/v4/shadow/member-history")
      ]);
      state.members = members.rows || []; state.roles = roles.rows || []; state.scopes = scopes.rows || []; state.history = history.rows || [];
      populateRoleSelect(inviteRole);
      refreshInviteControls();
      inviteDepartment.innerHTML = `<option value="">Không gán bộ phận</option>` + departments().map((row) => `<option value="${esc(row.scope_id)}">${esc(row.scope_code)} · ${esc(row.scope_name)}</option>`).join("");
      renderMembers(); renderHistory();
    } catch (error) { showNotice("error", error?.message || error); }
  }

  inviteRole.addEventListener("change", refreshInviteControls);
  inviteScopeType.addEventListener("change", () => populateScopeTargets(inviteScopeType.value, inviteScopeId, inviteScopeTargetLabel));

  inviteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await governedWrite("invite", {
        email: $("inviteEmail").value.trim(), display_name: $("inviteName").value.trim(), role_code: inviteRole.value,
        scope_type: inviteScopeType.value, scope_id: inviteScopeType.value === "ORGANIZATION" ? null : inviteScopeId.value,
        department_id: inviteDepartment.value || null, reason: $("inviteReason").value.trim()
      });
      inviteForm.reset(); showNotice("success", "Đã tạo lời mời và role assignment ở trạng thái INVITED."); await load();
    } catch (error) { showNotice("error", error?.message || error); }
  });

  function openAction(action, memberId, extra = {}) {
    const member = state.members.find((row) => row.membership_id === memberId);
    state.action = { action, memberId, ...extra };
    $("actionReason").value = "";
    $("roleActionFields").hidden = action !== "assign-role";
    if (action === "assign-role") {
      $("actionTitle").textContent = `Gán role · ${member?.display_name || "thành viên"}`;
      $("actionDescription").textContent = "Role mới chỉ có hiệu lực trong scope được chọn; DB sẽ chặn scope không hợp lệ và assignment trùng lặp.";
      populateRoleSelect(actionRole); populateScopeTypes(actionRole.value, actionScopeType); populateScopeTargets(actionScopeType.value, actionScopeId, actionScopeTargetLabel);
    } else if (action === "end-role") {
      $("actionTitle").textContent = `Kết thúc role · ${member?.display_name || "thành viên"}`;
      $("actionDescription").textContent = "Assignment được kết thúc bằng valid_to; lịch sử không bị xoá.";
    } else {
      $("actionTitle").textContent = `${extra.status} · ${member?.display_name || "thành viên"}`;
      $("actionDescription").textContent = extra.status === "DISABLED" ? "DISABLED sẽ kết thúc các role hiện hành (trừ OWNER được bảo vệ)." : "Thay đổi trạng thái có hiệu lực ngay khi backend V4 được release.";
    }
    dialog.showModal();
  }

  membersBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]"); if (!button) return;
    openAction(button.dataset.action, button.dataset.member, { status: button.dataset.status, assignmentId: button.dataset.assignment });
  });

  actionRole.addEventListener("change", () => { populateScopeTypes(actionRole.value, actionScopeType); populateScopeTargets(actionScopeType.value, actionScopeId, actionScopeTargetLabel); });
  actionScopeType.addEventListener("change", () => populateScopeTargets(actionScopeType.value, actionScopeId, actionScopeTargetLabel));

  $("confirmMemberAction").addEventListener("click", async () => {
    if (!state.action) return;
    const reason = $("actionReason").value.trim();
    if (reason.length < 3) { showNotice("error", "Cần nhập lý do audit tối thiểu 3 ký tự."); return; }
    try {
      if (state.action.action === "assign-role") await governedWrite("assign_role", { membership_id: state.action.memberId, role_code: actionRole.value, scope_type: actionScopeType.value, scope_id: actionScopeType.value === "ORGANIZATION" ? null : actionScopeId.value, reason });
      else if (state.action.action === "end-role") await governedWrite("end_role", { assignment_id: state.action.assignmentId, reason });
      else await governedWrite("set_status", { membership_id: state.action.memberId, status: state.action.status, reason });
      dialog.close(); state.action = null; showNotice("success", "Thao tác đã được ghi nhận qua governed V4 RPC."); await load();
    } catch (error) { showNotice("error", error?.message || error); }
  });

  $("refreshMembers").addEventListener("click", load);
  load();
})();
