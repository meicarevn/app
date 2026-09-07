(() => {
  "use strict";

  const config = window.MEICARE_SHADOW_CONFIG || {};
  const state = {
    gateway: config.gatewayUrl || sessionStorage.getItem("meicare.shadow.gateway") || location.origin,
    organizationId: config.organizationId || window.MEICARE_SESSION.selectedOrganizationId()
  };

  const statusBox = document.getElementById("statusBox");
  const metrics = document.getElementById("metrics");
  const cohortAEl = document.getElementById("cohortA");
  const cohortBEl = document.getElementById("cohortB");
  const refreshButton = document.getElementById("refreshButton");

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function num(value) {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  function fmt(value, digits = 0) {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(num(value));
  }

  function chip(label, tone = "info") {
    return `<span class="semantic-chip ${tone}">${esc(label)}</span>`;
  }

  function projection(row, stockElsewhere) {
    const usable = num(row.usable_quantity);
    const demandMissing = row.forecast_daily_demand == null && !row.last_true_issue_at;
    const engine = row.stock_status || null;

    let availability = "UNKNOWN";
    if (usable <= 0) availability = "OUT_OF_STOCK";
    else if (engine === "OVERSTOCK") availability = "OVERSTOCK";
    else if (["CRITICAL", "REORDER", "DEFAULT_LOW_STOCK", "LOW_STOCK"].includes(String(engine))) availability = "LOW";
    else if (usable > 0) availability = "HEALTHY";

    const rawExpiry = String(row.highest_expiry_risk || "").toUpperCase();
    let expiry = "NONE";
    if (["CRITICAL", "HIGH", "WARNING"].includes(rawExpiry)) expiry = rawExpiry;
    else if (num(row.near_expiry_quantity) > 0 || engine === "EXPIRY_RISK") expiry = "WARNING";

    const confidence = demandMissing ? "INSUFFICIENT_DATA" : expiry !== "NONE" && row.expiry_quantity_at_risk == null ? "LIMITED" : "SUFFICIENT";
    const action = usable <= 0
      ? (stockElsewhere ? "TRANSFER_REVIEW" : "PROCUREMENT_REVIEW")
      : expiry !== "NONE" ? "FEFO_REVIEW" : "NONE";

    return {
      semantic_model_version: "V4_010C_A1_B1",
      engine_stock_status: engine,
      availability_status: availability,
      evidence_confidence: confidence,
      expiry_status: expiry,
      expiry_evidence_basis: expiry !== "NONE" ? (demandMissing ? "TIME_WINDOW_ONLY" : "DEMAND_SUPPORTED") : "NONE",
      recommended_review_action: action,
      suppress_expected_wastage_claims: expiry !== "NONE" && demandMissing
    };
  }

  function drugOf(row) {
    return row.drugs || {};
  }

  function warehouseOf(row) {
    return row.warehouses || {};
  }

  async function api(path, params = {}) {
    if (!state.organizationId) throw new Error("PREVIEW_SESSION_REQUIRED");
    const base = state.gateway.replace(/\/+$/, "");
    const url = new URL(`${base}${path}`);
    url.searchParams.set("organization_id", state.organizationId);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const response = await window.MEICARE_SESSION.authorizedFetch(url.toString(), {
      method: "GET",
      headers: {
        "x-organization-id": state.organizationId,
        "x-request-id": crypto.randomUUID()
      },
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP_${response.status}`);
    return body;
  }

  async function loadAllInventory() {
    const rows = [];
    const limit = 200;
    for (let offset = 0; offset < 5000; offset += limit) {
      const page = await api("/v4/shadow/inventory", { limit, offset });
      rows.push(...(page.rows || []));
      const total = Number(page.total ?? rows.length);
      if ((page.rows || []).length < limit || rows.length >= total) break;
    }
    return rows;
  }

  function metric(label, value, hint, tone = "") {
    return `<article class="metric-card ${tone}"><div class="label">${esc(label)}</div><div class="value">${fmt(value)}</div><div class="hint">${esc(hint)}</div></article>`;
  }

  function renderA(rows, usableByDrug) {
    const cohort = rows.filter((r) => r.stock_status === "INSUFFICIENT_DATA" && num(r.usable_quantity) <= 0);
    const enriched = cohort.map((row) => {
      const elsewhere = (usableByDrug.get(row.drug_id) || 0) - num(row.usable_quantity) > 0;
      return { row, elsewhere, p: projection(row, elsewhere) };
    });
    const transfers = enriched.filter((x) => x.elsewhere).length;
    const procurement = enriched.length - transfers;

    const body = enriched.length ? `<div class="table-wrap"><table class="semantic-table"><thead><tr><th>Mã thuốc</th><th>Thuốc</th><th>Kho</th><th>Engine</th><th>A1 availability</th><th>Evidence</th><th>Human review</th></tr></thead><tbody>${enriched.slice(0, 120).map(({ row, p }) => {
      const d = drugOf(row); const w = warehouseOf(row);
      return `<tr><td><strong>${esc(d.drug_code || "—")}</strong></td><td>${esc(d.name || "—")}</td><td>${esc(w.code || "—")} · ${esc(w.name || "")}</td><td>${chip(p.engine_stock_status || "—", "warning")}</td><td>${chip(p.availability_status, "danger")}</td><td>${chip(p.evidence_confidence, "warning")}</td><td>${chip(p.recommended_review_action, p.recommended_review_action === "TRANSFER_REVIEW" ? "info" : "warning")}</td></tr>`;
    }).join("")}</tbody></table></div>` : `<div class="semantic-empty">Không có row phù hợp.</div>`;

    cohortAEl.innerHTML = `${body}<div class="semantic-note">A1 projected: ${fmt(enriched.length)} positions · ${fmt(transfers)} TRANSFER_REVIEW · ${fmt(procurement)} PROCUREMENT_REVIEW. Hiển thị tối đa 120 dòng; toàn bộ cohort vẫn được tính.</div>`;
    return { total: enriched.length, transfers, procurement };
  }

  function renderB(rows) {
    const cohort = rows.filter((r) => r.stock_status === "EXPIRY_RISK");
    const enriched = cohort.map((row) => ({ row, p: projection(row, false) }));
    const severity = enriched.reduce((acc, x) => {
      acc[x.p.expiry_status] = (acc[x.p.expiry_status] || 0) + 1;
      return acc;
    }, {});

    const body = enriched.length ? `<div class="table-wrap"><table class="semantic-table"><thead><tr><th>Mã thuốc</th><th>Thuốc</th><th>Kho</th><th>Usable</th><th>Expiry</th><th>Evidence</th><th>Expected wastage</th><th>Human review</th></tr></thead><tbody>${enriched.map(({ row, p }) => {
      const d = drugOf(row); const w = warehouseOf(row);
      const tone = p.expiry_status === "CRITICAL" ? "danger" : "warning";
      return `<tr><td><strong>${esc(d.drug_code || "—")}</strong></td><td>${esc(d.name || "—")}</td><td>${esc(w.code || "—")} · ${esc(w.name || "")}</td><td class="numeric">${fmt(row.usable_quantity, 3)}</td><td>${chip(p.expiry_status, tone)}</td><td>${chip(p.expiry_evidence_basis, "warning")}</td><td>${p.suppress_expected_wastage_claims ? chip("SUPPRESSED", "info") : chip("SUPPORTED", "success")}</td><td>${chip(p.recommended_review_action, "warning")}</td></tr>`;
    }).join("")}</tbody></table></div>` : `<div class="semantic-empty">Không có row phù hợp.</div>`;

    cohortBEl.innerHTML = `${body}<div class="semantic-note">B1 projected: ${fmt(enriched.length)} positions · CRITICAL ${fmt(severity.CRITICAL || 0)} · HIGH ${fmt(severity.HIGH || 0)} · WARNING ${fmt(severity.WARNING || 0)}. TIME_WINDOW_ONLY không được dùng để khẳng định quantity/value sẽ hết hạn.</div>`;
    return { total: enriched.length, severity };
  }

  async function load() {
    refreshButton.disabled = true;
    statusBox.className = "semantic-status";
    statusBox.textContent = "Đang tải toàn bộ inventory Shadow để áp A1/B1…";
    try {
      const rows = await loadAllInventory();
      const usableByDrug = new Map();
      for (const row of rows) usableByDrug.set(row.drug_id, (usableByDrug.get(row.drug_id) || 0) + num(row.usable_quantity));
      const a = renderA(rows, usableByDrug);
      const b = renderB(rows);
      metrics.innerHTML = [
        metric("Inventory rows", rows.length, "Shadow read only"),
        metric("A1 stockout + insufficient", a.total, "Approved A1 cohort", "warning"),
        metric("Transfer review", a.transfers, "Có usable stock ở kho khác", "info"),
        metric("Procurement review", a.procurement, "Organization-wide zero", "danger"),
        metric("B1 expiry positions", b.total, "Direct time-window evidence", "warning"),
        metric("B1 CRITICAL", b.severity.CRITICAL || 0, "Direct expiry-window severity", "danger")
      ].join("");
      statusBox.className = "semantic-status success";
      statusBox.innerHTML = `<strong>Shadow projection loaded.</strong> ${fmt(rows.length)} positions processed; production stock_status and alert publication were not changed.`;
    } catch (error) {
      statusBox.className = "semantic-status error";
      const message = error?.message || String(error);
      statusBox.innerHTML = message === "PREVIEW_SESSION_REQUIRED"
        ? `Cần phiên preview đã đăng nhập. <a href="/login">Mở trang đăng nhập</a>.`
        : `Không tải được semantic shadow: ${esc(message)}`;
      metrics.innerHTML = "";
      cohortAEl.innerHTML = "";
      cohortBEl.innerHTML = "";
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", load);
  load();
})();
