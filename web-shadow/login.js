(() => {
  "use strict";

  const SUPABASE_URL = "https://sgxufmcsnveyyddazwuk.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9xbWYiMtnriBmFwuiGp8Qw_FNTB8NFc";
  const ORGANIZATION_ID = "68d83220-4e5d-46e7-8bd3-7863205985f4";

  const form = document.getElementById("loginForm");
  const message = document.getElementById("message");
  const clearButton = document.getElementById("clearSession");

  function show(text, kind = "warning") {
    message.className = `notice ${kind}`;
    message.textContent = text;
    message.hidden = false;
  }

  function clearPreviewSession() {
    sessionStorage.removeItem("meicare.shadow.token");
    sessionStorage.removeItem("meicare.shadow.gateway");
    sessionStorage.removeItem("meicare.shadow.organization");
  }

  clearButton.addEventListener("click", () => {
    clearPreviewSession();
    document.getElementById("password").value = "";
    show("Đã xoá access token và cấu hình preview khỏi sessionStorage của tab này.", "success");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    if (!email || !password) return;

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({ email, password }),
        cache: "no-store"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.access_token !== "string") {
        throw new Error(response.status === 400 ? "Đăng nhập không thành công." : `AUTH_${response.status}`);
      }

      clearPreviewSession();
      sessionStorage.setItem("meicare.shadow.token", body.access_token);
      sessionStorage.setItem("meicare.shadow.gateway", location.origin);
      sessionStorage.setItem("meicare.shadow.organization", ORGANIZATION_ID);
      document.getElementById("password").value = "";
      location.replace("./");
    } catch (error) {
      clearPreviewSession();
      document.getElementById("password").value = "";
      show(error?.message || "Không thể đăng nhập preview.", "error");
    } finally {
      submit.disabled = false;
    }
  });
})();
