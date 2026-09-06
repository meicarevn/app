(() => {
  "use strict";

  const capabilityByView = {
    overview: "overview",
    inventory: "inventory",
    actions: "actions",
    reconciliations: "reconciliations",
    iot: "iot",
    documents: "documents",
    compare: "compare",
    readiness: "readiness"
  };

  const roleBadge = document.getElementById("roleBadge");
  const sessionContext = document.getElementById("sessionContext");
  const scopeNotice = document.getElementById("scopeNotice");
  const saveConnectionButton = document.getElementById("saveConnectionButton");
  const memberAdminLink = document.getElementById("memberAdminLink");

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function config() {
    const boot = window.MEICARE_SHADOW_CONFIG || {};
    return {
      gateway: boot.gatewayUrl || sessionStorage.getItem("meicare.shadow.gateway") || "",
      organizationId: boot.organizationId || sessionStorage.getItem("meicare.shadow.organization") || "",
      token: boot.accessToken || sessionStorage.getItem("meicare.shadow.token") || ""
    };
  }

  function resetRoleUi() {
    roleBadge.hidden = true;
    roleBadge.textContent = "ROLE";
    sessionContext.hidden = true;
    sessionContext.textContent = "";
    scopeNotice.hidden = true;
    if (memberAdminLink) memberAdminLink.hidden = true;
    document.querySelectorAll(".nav-item").forEach((item) => { item.hidden = false; });
  }

  function applyCapabilities(session) {
    const capabilities = session.capabilities || {};
    document.querySelectorAll(".nav-item").forEach((item) => {
      const required = capabilityByView[item.dataset.view];
      item.hidden = required ? capabilities[required] !== true : false;
    });
    if (memberAdminLink) memberAdminLink.hidden = capabilities.member_admin !== true;

    const roles = Array.isArray(session.roles) ? session.roles : [];
    const roleCodes = [...new Set(roles.map((role) => role.role_code).filter(Boolean))];
    roleBadge.textContent = roleCodes.length ? roleCodes.join(" + ") : "NO ROLE";
    roleBadge.hidden = false;

    const scopeLabels = roles.map((role) => {
      const scope = role.scope_type || "ORGANIZATION";
      return `${role.role_code || "ROLE"} · ${scope}${role.scope_id ? ` · ${role.scope_id}` : ""}`;
    });
    sessionContext.innerHTML = [
      `<span class="session-chip">User ${escapeHtml(String(session.user_id || "").slice(0, 8))}…</span>`,
      ...scopeLabels.map((label) => `<span class="session-chip">${escapeHtml(label)}</span>`),
      `<span class="session-chip">${escapeHtml(String((session.permissions || []).length))} quyền hiệu lực</span>`
    ].join("");
    sessionContext.hidden = false;
    scopeNotice.hidden = session.scope_warning !== true;
  }

  async function refreshSession() {
    const current = config();
    if (!current.gateway || !current.organizationId || !current.token) {
      resetRoleUi();
      return;
    }

    try {
      const base = current.gateway.replace(/\/+$/, "");
      const url = new URL(`${base}/v4/shadow/session`);
      url.searchParams.set("organization_id", current.organizationId);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          authorization: `Bearer ${current.token}`,
          "x-organization-id": current.organizationId,
          "x-request-id": crypto.randomUUID()
        },
        cache: "no-store"
      });
      if (!response.ok) {
        resetRoleUi();
        return;
      }
      applyCapabilities(await response.json());
    } catch {
      resetRoleUi();
    }
  }

  saveConnectionButton?.addEventListener("click", () => {
    window.setTimeout(refreshSession, 150);
  });

  window.addEventListener("focus", refreshSession);
  refreshSession();
})();
