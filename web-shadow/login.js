(() => {
  "use strict";

  const form = document.getElementById("loginForm");
  const message = document.getElementById("message");
  const clearButton = document.getElementById("clearSession");

  function show(text, kind = "warning") {
    message.className = `notice ${kind}`;
    message.textContent = text;
    message.hidden = false;
  }

  clearButton.addEventListener("click", async () => {
    await window.MEICARE_SESSION.signOut();
    document.getElementById("password").value = "";
    show("Đã đăng xuất an toàn khỏi phiên làm việc trên thiết bị này.", "success");
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
      await window.MEICARE_SESSION.signIn(email, password);
      document.getElementById("password").value = "";
      location.replace("./");
    } catch (error) {
      window.MEICARE_SESSION.clear();
      document.getElementById("password").value = "";
      const messages = {
        AUTH_INVALID_CREDENTIALS: "Email hoặc mật khẩu không đúng.",
        NO_ACTIVE_ORGANIZATION_ROLE: "Tài khoản chưa được phân quyền vào bệnh viện đang hoạt động.",
        SESSION_EXPIRED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
      };
      show(messages[error?.message] || "Không thể đăng nhập. Vui lòng thử lại.", "error");
    } finally {
      submit.disabled = false;
    }
  });
})();
