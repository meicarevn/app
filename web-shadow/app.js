(() => {
  "use strict";

  const config = window.MEICARE_SHADOW_CONFIG || {};
  const state = {
    view: "overview",
    limit: 50,
    offset: 0,
    inventoryStatus: "",
    gateway: config.gatewayUrl || location.origin,
    organizationId: config.organizationId || window.MEICARE_SESSION.selectedOrganizationId()
  };

  const titles = {
    overview: ["Tổng quan vận hành", "Quan sát dữ liệu V4 mà không thay đổi luồng production."],
    inventory: ["Kho thông minh V4", "Drug code × warehouse là trục vận hành; dữ liệu chỉ đọc từ Intelligence V4."],
    actions: ["Action Center", "Ưu tiên rủi ro và hành động đề xuất; Shadow UI không thực thi hành động."],
    reconciliations: ["Đối soát HIS", "Theo dõi ingestion, sai lệch và case cần human review trước commit."],
    iot: ["IoT / GSP", "Trạng thái thiết bị, nhiệt độ, độ ẩm, calibration và excursion."],
    documents: ["Tài liệu & Evidence", "Registry, phiên bản hiện hành, checksum và bằng chứng đã xác minh."],
    compare: ["So sánh V3 ↔ V4", "Đối chiếu quantity truth và sự khác biệt semantics giữa hai thế hệ."],
    readiness: ["Production Gate", "Hiển thị điều kiện cutover; màn hình này không thể thay đổi runtime mode."]
  };

  const root = document.getElementById("viewRoot");
  const loading = document.getElementById("loading");
  const errorNotice = document.getElementById("errorNotice");
  const connectionNotice = document.getElementById("connectionNotice");
  const connectionDialog = document.getElementById("connectionDialog");
  const orgInput = document.getElementById("orgInput");
  const connectionButton = document.getElementById("connectionButton");
  let hasRenderedView = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value, digits = 0) {
    if (value == null || value === "") return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return escapeHtml(value);
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(n);
  }

  function formatMoney(value) {
    if (value == null || value === "") return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return escapeHtml(value);
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(n);
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return new Intl.DateTimeFormat("vi-VN", includeTime ? {
      dateStyle: "short", timeStyle: "short"
    } : { dateStyle: "short" }).format(date);
  }

  function pill(value) {
    const label = String(value || "UNKNOWN");
    const danger = ["OUT_OF_STOCK", "CRITICAL", "BLOCKED", "FAILED", "OFFLINE", "OVERDUE", "REJECTED"].includes(label);
    const warning = ["REORDER", "EXPIRY_RISK", "DEFAULT_LOW_STOCK", "WARNING", "INSUFFICIENT_DATA", "PENDING", "IN_REVIEW"].includes(label);
    const success = ["HEALTHY", "ONLINE", "AVAILABLE", "COMPLETED", "APPROVED", "EFFECTIVE", "PASS", "READY_FOR_REVIEW"].includes(label);
    const cls = danger ? "danger" : warning ? "warning" : success ? "success" : "info";
    return `<span class="status-pill ${cls}">${escapeHtml(label)}</span>`;
  }

  function empty() {
    return `<div class="empty-state"><strong>Chưa có dữ liệu phù hợp</strong><span>Shadow layer không tự tạo dữ liệu mẫu.</span></div>`;
  }

  function configured() {
    return Boolean(state.gateway && state.organizationId);
  }

  function updateConnectionNotice() {
    connectionNotice.hidden = configured();
  }

  function normalizedGateway() {
    return state.gateway.replace(/\/+$/, "");
  }

  async function api(path, params = {}) {
    if (!configured()) throw new Error("SHADOW_CONNECTION_REQUIRED");
    const url = new URL(`${normalizedGateway()}${path}`);
    url.searchParams.set("organization_id", state.organizationId);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await window.MEICARE_SESSION.authorizedFetch(url.toString(), {
      method: "GET",
      headers: {
        "x-organization-id": state.organizationId,
        "x-request-id": crypto.randomUUID()
      },
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `HTTP_${response.status}`);
      error.requestId = body.request_id || response.headers.get("x-request-id");
      throw error;
    }
    return body;
  }

  function organizationLabel(organization) {
    const suffix = organization.code ? ` · ${organization.code}` : "";
    return `${organization.name || "Bệnh viện"}${suffix}`;
  }

  async function refreshOrganizations(openSelector = false) {
    const organizations = await window.MEICARE_SESSION.organizations();
    if (!organizations.length) throw new Error("NO_ACTIVE_ORGANIZATION_ROLE");
    state.organizationId = window.MEICARE_SESSION.selectedOrganizationId();
    orgInput.innerHTML = organizations.map((organization) => (
      `<option value="${escapeHtml(organization.id)}" ${organization.id === state.organizationId ? "selected" : ""}>${escapeHtml(organizationLabel(organization))}</option>`
    )).join("");

    const selected = organizations.find((organization) => organization.id === state.organizationId);
    connectionButton.textContent = selected ? organizationLabel(selected) : "Chọn bệnh viện";
    updateConnectionNotice();
    if (openSelector || (!state.organizationId && organizations.length > 1)) connectionDialog.showModal();
    return organizations;
  }

  function showError(error) {
    const code = String(error?.message || "UNKNOWN_ERROR");
    if (["UNAUTHORIZED", "SESSION_REQUIRED", "SESSION_EXPIRED", "AUTH_INVALID_CREDENTIALS"].includes(code)) {
      window.MEICARE_SESSION.clear();
      window.MEICARE_SESSION.redirectToLogin("session_expired");
      return;
    }

    const messages = {
      SHADOW_PERMISSION_DENIED: "Tài khoản không có quyền xem nội dung này.",
      SHADOW_SCOPE_DENIED: "Vai trò hiện tại không có phạm vi toàn bệnh viện cho nội dung này.",
      NO_ACTIVE_ORGANIZATION_ROLE: "Tài khoản không còn vai trò hiệu lực tại bệnh viện đã chọn.",
      SHADOW_ACCESS_READ_FAILED: "Không thể xác minh quyền truy cập. Vui lòng thử lại.",
      SHADOW_PREVIEW_FAILED: "Dịch vụ dữ liệu tạm thời không khả dụng.",
      V4_011_SHADOW_READ_FAILED: "Không thể tải mô hình phân tích kho lúc này.",
      FAILED_TO_FETCH: "Không thể kết nối tới MEICARE. Hãy kiểm tra mạng và thử lại."
    };
    const normalized = navigator.onLine === false || /failed to fetch|networkerror|load failed/i.test(code)
      ? "FAILED_TO_FETCH"
      : code;
    const message = messages[normalized] || (code.startsWith("HTTP_5") ? "Dịch vụ tạm thời không khả dụng." : "Không thể tải dữ liệu lúc này.");
    errorNotice.hidden = false;
    const rid = error?.requestId ? ` · Request ${escapeHtml(error.requestId)}` : "";
    const chooseOrganization = ["SHADOW_PERMISSION_DENIED", "SHADOW_SCOPE_DENIED", "NO_ACTIVE_ORGANIZATION_ROLE"].includes(code);
    errorNotice.innerHTML = `
      <div class="notice-copy"><strong>Chưa thể cập nhật dữ liệu.</strong><span>${escapeHtml(message)}${rid}</span></div>
      <div class="notice-actions">
        <button class="secondary-button" type="button" data-error-action="retry">Thử lại</button>
        ${chooseOrganization ? '<button class="secondary-button" type="button" data-error-action="organization">Đổi bệnh viện</button>' : ""}
      </div>`;
    errorNotice.querySelector('[data-error-action="retry"]')?.addEventListener("click", load);
    errorNotice.querySelector('[data-error-action="organization"]')?.addEventListener("click", async () => {
      try {
        await refreshOrganizations(true);
      } catch (organizationError) {
        showError(organizationError);
      }
    });
  }

  function clearError() {
    errorNotice.hidden = true;
    errorNotice.textContent = "";
  }

  function metric(label, value, hint = "", tone = "") {
    return `<article class="metric-card ${tone}"><div class="label">${escapeHtml(label)}</div><div class="value">${formatNumber(value)}</div>${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ""}</article>`;
  }

  function panel(title, subtitle, content) {
    return `<section class="panel"><header class="panel-header"><div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div></header><div class="panel-body">${content}</div></section>`;
  }

  function pagination(total, limit, offset) {
    const from = total === 0 ? 0 : offset + 1;
    const to = total == null ? offset + limit : Math.min(offset + limit, total);
    const disabledPrev = offset <= 0 ? "disabled" : "";
    const disabledNext = total != null && offset + limit >= total ? "disabled" : "";
    return `<div class="pagination"><span>${formatNumber(from)}–${formatNumber(to)}${total == null ? "" : ` / ${formatNumber(total)}`}</span><div class="buttons"><button class="secondary-button" data-page="prev" ${disabledPrev}>Trước</button><button class="secondary-button" data-page="next" ${disabledNext}>Sau</button></div></div>`;
  }

  async function renderOverview() {
    const data = await api("/v4/shadow/overview");
    const inv = data.inventory || {};
    const readiness = data.readiness || {};
    root.innerHTML = `
      <div class="metrics-grid">
        ${metric("Vị trí tồn kho", inv.positions, "Drug × warehouse")}
        ${metric("Hết hàng", inv.out_of_stock, "V4 OUT_OF_STOCK", "danger")}
        ${metric("Cần hành động", inv.actionable, "Out + critical + reorder + expiry", "warning")}
        ${metric("Thiếu dữ liệu", inv.insufficient_data, "Không suy diễn khi evidence chưa đủ")}
        ${metric("Action Center", data.action_center?.items || 0)}
        ${metric("Đối soát HIS", data.reconciliation?.runs || 0)}
        ${metric("Thiết bị IoT", data.iot?.devices || 0)}
        ${metric("Tài liệu Registry", data.documents?.documents || 0)}
      </div>
      <div class="split-grid">
        ${panel("Runtime V4", "Production vẫn không bị chuyển bởi Shadow UI.", `
          <dl class="key-value">
            <dt>Cutover stage</dt><dd>${pill(readiness.cutover_stage)}</dd>
            <dt>Inventory write</dt><dd>${pill(readiness.inventory_write_mode)}</dd>
            <dt>Alert publish</dt><dd>${pill(readiness.alert_publish_mode)}</dd>
            <dt>HIS ingestion</dt><dd>${pill(readiness.his_ingestion_mode)}</dd>
            <dt>Frontend V4 ready</dt><dd>${pill(readiness.frontend_v4_ready ? "TRUE" : "FALSE")}</dd>
          </dl>`)}
        ${panel("Risk snapshot", "Phân loại Intelligence V4.", `
          <dl class="key-value">
            <dt>Critical</dt><dd>${formatNumber(inv.critical)}</dd>
            <dt>Reorder</dt><dd>${formatNumber(inv.reorder)}</dd>
            <dt>Expiry risk</dt><dd>${formatNumber(inv.expiry_risk)}</dd>
            <dt>Generated</dt><dd>${formatDate(data.generated_at, true)}</dd>
          </dl>`)}
      </div>`;
  }

  function inventoryRows(rows) {
    if (!rows?.length) return empty();
    return `<div class="table-wrap"><table><thead><tr><th>Mã thuốc</th><th>Thuốc</th><th>Kho</th><th>Trạng thái</th><th class="numeric">QOH</th><th class="numeric">Usable</th><th class="numeric">Cận date</th><th class="numeric">DOS</th><th class="numeric">Risk</th><th>Khuyến nghị</th></tr></thead><tbody>${rows.map((row) => {
      const drug = row.drugs || {};
      const warehouse = row.warehouses || {};
      return `<tr>
        <td><strong>${escapeHtml(drug.drug_code || "—")}</strong></td>
        <td>${escapeHtml(drug.name || "—")}<div class="subtle">${escapeHtml([drug.strength, drug.unit].filter(Boolean).join(" · "))}</div></td>
        <td>${escapeHtml(warehouse.code || "—")}<div class="subtle">${escapeHtml(warehouse.name || "")}</div></td>
        <td>${pill(row.stock_status)}</td>
        <td class="numeric">${formatNumber(row.quantity_on_hand, 3)}</td>
        <td class="numeric">${formatNumber(row.usable_quantity, 3)}</td>
        <td class="numeric">${formatNumber(row.near_expiry_quantity, 3)}</td>
        <td class="numeric">${formatNumber(row.days_of_supply, 1)}</td>
        <td class="numeric">${formatNumber(row.risk_score, 1)}</td>
        <td>${escapeHtml(row.recommendation_basis || "—")}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
  }

  async function renderInventory() {
    const data = await api("/v4/shadow/inventory", { limit: state.limit, offset: state.offset, status: state.inventoryStatus });
    root.innerHTML = `${panel("Inventory Intelligence", "Sắp xếp theo risk score; chỉ đọc.", `
      <div class="toolbar"><label>Trạng thái <select id="inventoryStatus"><option value="">Tất cả</option>${["OUT_OF_STOCK","CRITICAL","REORDER","EXPIRY_RISK","DEFAULT_LOW_STOCK","OVERSTOCK","SLOW_MOVING","HEALTHY","INSUFFICIENT_DATA"].map((s) => `<option value="${s}" ${state.inventoryStatus === s ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>
      ${inventoryRows(data.rows)}${pagination(data.total, data.limit, data.offset)}`)}`;
    document.getElementById("inventoryStatus")?.addEventListener("change", (event) => {
      state.inventoryStatus = event.target.value;
      state.offset = 0;
      load();
    });
    bindPagination();
  }

  async function renderActions() {
    const data = await api("/v4/shadow/actions", { limit: state.limit, offset: state.offset });
    const content = !data.rows?.length ? empty() : `<div class="table-wrap"><table><thead><tr><th>Ưu tiên</th><th>Tiêu đề</th><th>Trạng thái</th><th>Nguồn</th><th class="numeric">Risk</th><th>Khuyến nghị</th><th>Hạn</th></tr></thead><tbody>${data.rows.map((row) => `<tr><td>${pill(row.priority)}</td><td><strong>${escapeHtml(row.title || "—")}</strong><div class="subtle">${escapeHtml(row.description || "")}</div></td><td>${pill(row.status)}</td><td>${escapeHtml(row.source_type || "—")}</td><td class="numeric">${formatNumber(row.risk_score,1)}</td><td>${escapeHtml(row.recommended_action || "—")}</td><td>${formatDate(row.due_at,true)}</td></tr>`).join("")}</tbody></table></div>`;
    root.innerHTML = panel("Action Center V4", "Không có nút approve/execute trong Shadow UI.", `${content}${pagination(data.total, data.limit, data.offset)}`);
    bindPagination();
  }

  async function renderReconciliations() {
    const data = await api("/v4/shadow/reconciliations", { limit: 30, offset: state.offset });
    const content = !data.rows?.length ? empty() : `<div class="table-wrap"><table><thead><tr><th>Nguồn</th><th>Quan sát</th><th>Trạng thái</th><th class="numeric">Rows</th><th class="numeric">Variance</th><th class="numeric">Blocking</th><th class="numeric">Warning</th><th class="numeric">Open cases</th><th class="numeric">DQ</th></tr></thead><tbody>${data.rows.map((row) => `<tr><td>${escapeHtml(row.source_system || "—")}<div class="subtle">${escapeHtml(row.source_file_name || "")}</div></td><td>${formatDate(row.observed_at,true)}</td><td>${pill(row.status || row.import_reconciliation_status)}</td><td class="numeric">${formatNumber(row.compared_rows)}</td><td class="numeric">${formatNumber(row.quantity_variance,3)}</td><td class="numeric">${formatNumber(row.blocking_rows)}</td><td class="numeric">${formatNumber(row.warning_rows)}</td><td class="numeric">${formatNumber(row.open_cases)}</td><td class="numeric">${formatNumber(row.data_quality_score,1)}</td></tr>`).join("")}</tbody></table></div>`;
    root.innerHTML = panel("Inventory Reconciliation", "Staging và case review không đồng nghĩa với ledger commit.", `${content}${pagination(data.total, data.limit, data.offset)}`);
    bindPagination();
  }

  async function renderIot() {
    const data = await api("/v4/shadow/iot", { limit: 100, offset: state.offset });
    const content = !data.rows?.length ? empty() : `<div class="table-wrap"><table><thead><tr><th>Thiết bị</th><th>Health</th><th>Vị trí</th><th class="numeric">°C</th><th class="numeric">RH%</th><th>Online</th><th class="numeric">Excursion</th><th>Last seen</th><th>Calibration due</th></tr></thead><tbody>${data.rows.map((row) => `<tr><td><strong>${escapeHtml(row.device_uid)}</strong><div class="subtle">${escapeHtml(row.device_name || "")}</div></td><td>${pill(row.health_status)}</td><td>${escapeHtml(row.position_description || "—")}</td><td class="numeric">${formatNumber(row.temperature,1)}</td><td class="numeric">${formatNumber(row.humidity,1)}</td><td>${pill(row.online ? "ONLINE" : "OFFLINE")}</td><td class="numeric">${formatNumber(row.open_excursions)}</td><td>${formatDate(row.last_seen_at,true)}</td><td>${formatDate(row.calibration_due_at)}</td></tr>`).join("")}</tbody></table></div>`;
    root.innerHTML = panel("IoT Health V4", "Reading evidence và excursion được quan sát; Shadow UI không quarantine thuốc.", `${content}${pagination(data.total, data.limit, data.offset)}`);
    bindPagination();
  }

  async function renderDocuments() {
    const data = await api("/v4/shadow/documents", { limit: state.limit, offset: state.offset });
    const content = !data.rows?.length ? empty() : `<div class="table-wrap"><table><thead><tr><th>Mã</th><th>Tài liệu</th><th>Classification</th><th>Trạng thái</th><th>Current</th><th>Latest</th><th class="numeric">Evidence</th><th class="numeric">Verified</th><th class="numeric">Pending approval</th><th>Review</th></tr></thead><tbody>${data.rows.map((row) => `<tr><td><strong>${escapeHtml(row.document_code)}</strong></td><td>${escapeHtml(row.title)}<div class="subtle">${escapeHtml(row.document_type)}</div></td><td>${pill(row.classification)}</td><td>${pill(row.status)}</td><td>v${escapeHtml(row.current_version_number ?? "—")}<div class="subtle">${escapeHtml(row.current_checksum_sha256 ? `${row.current_checksum_sha256.slice(0,12)}…` : "")}</div></td><td>v${escapeHtml(row.latest_version_number ?? "—")} ${pill(row.latest_version_status)}</td><td class="numeric">${formatNumber(row.evidence_count)}</td><td class="numeric">${formatNumber(row.verified_evidence_count)}</td><td class="numeric">${formatNumber(row.pending_approvals)}</td><td>${formatDate(row.review_date)}</td></tr>`).join("")}</tbody></table></div>`;
    root.innerHTML = panel("Document Registry", "Current approved version được tách khỏi latest uploaded version.", `${content}${pagination(data.total, data.limit, data.offset)}`);
    bindPagination();
  }

  async function renderCompare() {
    const data = await api("/v4/shadow/compare/inventory");
    const truthAligned = data.missing_in_v3 === 0 && data.missing_in_v4 === 0 && data.quantity_mismatch_count === 0;
    const summary = truthAligned
      ? `<div class="compare-ok"><strong>Quantity truth đang khớp.</strong> ${formatNumber(data.matched_keys)} khóa warehouse × drug được match, không có quantity drift.</div>`
      : `<div class="compare-warning"><strong>Có khác biệt quantity/key.</strong> Cần điều tra trước khi cutover read path.</div>`;
    const samples = !data.sample_mismatches?.length ? empty() : `<div class="table-wrap"><table><thead><tr><th>Key</th><th>Mismatch</th><th class="numeric">Q V3</th><th class="numeric">Q V4</th><th class="numeric">Δ</th><th>Status V3</th><th>Status V4</th></tr></thead><tbody>${data.sample_mismatches.map((row) => `<tr><td>${escapeHtml(row.key)}</td><td>${escapeHtml(row.mismatch || "SEMANTIC")}</td><td class="numeric">${formatNumber(row.quantity_v3,3)}</td><td class="numeric">${formatNumber(row.quantity_v4,3)}</td><td class="numeric">${formatNumber(row.quantity_delta,3)}</td><td>${pill(row.status_v3)}</td><td>${pill(row.status_v4)}</td></tr>`).join("")}</tbody></table></div>`;
    root.innerHTML = `
      ${summary}
      <div class="metrics-grid" style="margin-top:18px">
        ${metric("V3 rows", data.v3_rows)}${metric("V4 rows", data.v4_rows)}${metric("Quantity mismatch", data.quantity_mismatch_count, "Truth drift")}${metric("Status mismatch", data.status_mismatch_count, "Semantics may intentionally differ", data.status_mismatch_count ? "warning" : "success")}
      </div>
      ${panel("Mismatch sample", "Status mismatch không mặc định là lỗi: V4 có semantics mới như EXPIRY_RISK và INSUFFICIENT_DATA.", samples)}`;
  }

  async function renderReadiness() {
    const data = await api("/v4/shadow/readiness");
    const row = data.readiness;
    if (!row) { root.innerHTML = empty(); return; }
    root.innerHTML = `
      <div class="metrics-grid">
        ${metric("Blocking", row.blocking_failure_count ?? 0, "Latest gate", row.blocking_failure_count ? "danger" : "success")}
        ${metric("Warnings", row.warning_count ?? 0, "Latest gate", row.warning_count ? "warning" : "")}
        ${metric("Last gate", row.last_gate_passed ? 1 : 0, row.last_gate_passed ? "PASS" : "NOT PASSED", row.last_gate_passed ? "success" : "warning")}
        ${metric("Frontend ready", row.frontend_v4_ready ? 1 : 0, row.frontend_v4_ready ? "TRUE" : "FALSE", row.frontend_v4_ready ? "success" : "warning")}
      </div>
      ${panel("Cutover controls", "Read-only rendering of production_readiness_v4.", `<dl class="key-value">
        <dt>Cutover stage</dt><dd>${pill(row.cutover_stage)}</dd>
        <dt>Inventory write</dt><dd>${pill(row.inventory_write_mode)}</dd>
        <dt>Alert publish</dt><dd>${pill(row.alert_publish_mode)}</dd>
        <dt>HIS ingestion</dt><dd>${pill(row.his_ingestion_mode)}</dd>
        <dt>Integration layer</dt><dd>${pill(row.integration_layer_ready ? "READY" : "NOT_READY")}</dd>
        <dt>R2 gateway</dt><dd>${pill(row.r2_gateway_ready ? "READY" : "NOT_READY")}</dd>
        <dt>IoT gateway</dt><dd>${pill(row.iot_gateway_ready ? "READY" : "NOT_READY")}</dd>
        <dt>AI orchestrator</dt><dd>${pill(row.ai_orchestrator_ready ? "READY" : "NOT_READY")}</dd>
        <dt>Backup/restore</dt><dd>${formatDate(row.backup_restore_verified_at,true)}</dd>
        <dt>Last gate at</dt><dd>${formatDate(row.last_gate_at,true)}</dd>
      </dl>`)}`;
  }

  function bindPagination() {
    root.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        state.offset = Math.max(0, state.offset + (button.dataset.page === "next" ? state.limit : -state.limit));
        load();
      });
    });
  }

  async function load() {
    clearError();
    updateConnectionNotice();
    const [title, subtitle] = titles[state.view];
    document.getElementById("pageTitle").textContent = title;
    document.getElementById("pageSubtitle").textContent = subtitle;
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === state.view));

    if (!configured()) {
      root.innerHTML = empty();
      return;
    }

    loading.hidden = false;
    root.setAttribute("aria-busy", "true");
    try {
      if (state.view === "overview") await renderOverview();
      else if (state.view === "inventory") await renderInventory();
      else if (state.view === "actions") await renderActions();
      else if (state.view === "reconciliations") await renderReconciliations();
      else if (state.view === "iot") await renderIot();
      else if (state.view === "documents") await renderDocuments();
      else if (state.view === "compare") await renderCompare();
      else if (state.view === "readiness") await renderReadiness();
      hasRenderedView = true;
    } catch (error) {
      if (!hasRenderedView) root.innerHTML = empty();
      showError(error);
    } finally {
      loading.hidden = true;
      root.removeAttribute("aria-busy");
    }
  }

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      state.view = item.dataset.view;
      state.offset = 0;
      load();
      document.getElementById("content").focus({ preventScroll: true });
    });
  });

  document.getElementById("refreshButton").addEventListener("click", load);
  connectionButton.addEventListener("click", async () => {
    try {
      await refreshOrganizations(true);
    } catch (error) {
      showError(error);
    }
  });

  document.getElementById("saveConnectionButton").addEventListener("click", () => {
    const organization = orgInput.value;
    if (!organization) return;
    window.MEICARE_SESSION.selectOrganization(organization);
    state.organizationId = organization;
    connectionDialog.close();
    updateConnectionNotice();
    load();
  });

  document.getElementById("logoutButton").addEventListener("click", async () => {
    await window.MEICARE_SESSION.signOut();
    window.MEICARE_SESSION.redirectToLogin("signed_out");
  });

  window.addEventListener("meicare:session-expired", () => {
    window.MEICARE_SESSION.redirectToLogin("session_expired");
  });
  window.addEventListener("online", () => {
    if (configured()) load();
  });

  updateConnectionNotice();
  refreshOrganizations()
    .then(load)
    .catch((error) => {
      if (["SESSION_REQUIRED", "SESSION_EXPIRED", "UNAUTHORIZED"].includes(error?.message)) {
        window.MEICARE_SESSION.redirectToLogin("session_expired");
        return;
      }
      showError(error);
    });
})();
