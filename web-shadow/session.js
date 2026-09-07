(() => {
  "use strict";

  const SUPABASE_URL = "https://sgxufmcsnveyyddazwuk.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9xbWYiMtnriBmFwuiGp8Qw_FNTB8NFc";
  const keys = {
    accessToken: "meicare.shadow.token",
    refreshToken: "meicare.shadow.refresh",
    expiresAt: "meicare.shadow.expiresAt",
    gateway: "meicare.shadow.gateway",
    organization: "meicare.shadow.organization",
    organizations: "meicare.shadow.organizations"
  };
  let refreshPromise = null;

  function clear() {
    Object.values(keys).forEach((key) => sessionStorage.removeItem(key));
  }

  function storeSession(payload) {
    if (!payload || typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") {
      throw new Error("AUTH_SESSION_INVALID");
    }
    const expiresAt = Number(payload.expires_at) || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600);
    sessionStorage.setItem(keys.accessToken, payload.access_token);
    sessionStorage.setItem(keys.refreshToken, payload.refresh_token);
    sessionStorage.setItem(keys.expiresAt, String(expiresAt));
    sessionStorage.setItem(keys.gateway, location.origin);
  }

  async function authToken(grantType, body) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = response.status === 400 ? "AUTH_INVALID_CREDENTIALS" : `AUTH_${response.status}`;
      throw new Error(code);
    }
    storeSession(payload);
    return payload;
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    const refreshToken = sessionStorage.getItem(keys.refreshToken);
    if (!refreshToken) throw new Error("SESSION_EXPIRED");
    refreshPromise = authToken("refresh_token", { refresh_token: refreshToken })
      .catch((error) => {
        clear();
        throw error;
      })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function accessToken() {
    const token = sessionStorage.getItem(keys.accessToken);
    if (!token) throw new Error("SESSION_REQUIRED");
    const expiresAt = Number(sessionStorage.getItem(keys.expiresAt) || 0);
    if (expiresAt && expiresAt - Math.floor(Date.now() / 1000) <= 60) {
      await refresh();
      return sessionStorage.getItem(keys.accessToken);
    }
    return token;
  }

  async function authorizedFetch(input, init = {}, retry = true) {
    const headers = new Headers(init.headers || {});
    headers.set("authorization", `Bearer ${await accessToken()}`);
    if (!headers.has("x-request-id")) headers.set("x-request-id", crypto.randomUUID());
    const response = await fetch(input, { ...init, headers, cache: "no-store" });
    if (response.status === 401 && retry && sessionStorage.getItem(keys.refreshToken)) {
      await refresh();
      return authorizedFetch(input, init, false);
    }
    return response;
  }

  function selectedOrganizationId() {
    return sessionStorage.getItem(keys.organization) || "";
  }

  function selectOrganization(organizationId) {
    const value = String(organizationId || "").trim();
    const organizations = cachedOrganizations();
    if (!organizations.some((organization) => organization.id === value)) {
      throw new Error("ORGANIZATION_NOT_AVAILABLE");
    }
    sessionStorage.setItem(keys.organization, value);
    window.dispatchEvent(new CustomEvent("meicare:organization-changed", { detail: { organizationId: value } }));
  }

  function cachedOrganizations() {
    try {
      const value = JSON.parse(sessionStorage.getItem(keys.organizations) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  async function organizations() {
    const response = await authorizedFetch(`${location.origin}/v4/shadow/organizations`, { method: "GET" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.organizations)) {
      throw new Error(payload.error || `ORGANIZATIONS_${response.status}`);
    }
    const rows = payload.organizations.filter((organization) => organization && typeof organization.id === "string");
    sessionStorage.setItem(keys.organizations, JSON.stringify(rows));
    const selected = selectedOrganizationId();
    if (selected && !rows.some((organization) => organization.id === selected)) {
      sessionStorage.removeItem(keys.organization);
    }
    if (rows.length === 1) selectOrganization(rows[0].id);
    return rows;
  }

  async function signIn(email, password) {
    clear();
    await authToken("password", { email, password });
    const rows = await organizations();
    if (!rows.length) {
      await signOut();
      throw new Error("NO_ACTIVE_ORGANIZATION_ROLE");
    }
    return rows;
  }

  async function signOut() {
    const token = sessionStorage.getItem(keys.accessToken);
    try {
      if (token) {
        await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            authorization: `Bearer ${token}`
          },
          cache: "no-store"
        });
      }
    } catch {
      // Local logout must still succeed when Auth is temporarily unreachable.
    } finally {
      clear();
    }
  }

  window.MEICARE_SESSION = {
    authorizedFetch,
    cachedOrganizations,
    clear,
    organizations,
    refresh,
    selectedOrganizationId,
    selectOrganization,
    signIn,
    signOut
  };
})();
