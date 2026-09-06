(() => {
  "use strict";

  const config = window.MEICARE_SHADOW_CONFIG || {};
  const state = {
    gateway: config.gatewayUrl || sessionStorage.getItem("meicare.shadow.gateway") || location.origin,
    organizationId: config.organizationId || sessionStorage.getItem("meicare.shadow.organization") || "",
    token: config.accessToken || sessionStorage.getItem("meicare.shadow.token") || "",
    limit: 100,
    offset: 0,
    total: 0,
    filters: { availability: "", expiry: "", recommendation: "", cohort: "" }
  };

  const $ = (id) => document.getElementById(id);
  const statusBox = $("statusBox");
  const metrics = $("metrics");
  const cohortSummary = $("cohortSummary");
  const rowsRoot = $("rowsRoot");
  const pageInfo = $("pageInfo");

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function num(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function fmt(value, digits = 0) {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(num(value));
  }

  function tone(value) {
    const v = String(value || "");
    if (["OUT_OF_STOCK", "CRITICAL"].includes(v)) return "danger";
    if (["REORDER", "HIGH", "WARNING", "PROCUREMENT_REVIEW", "FEFO_REVIEW", "POLICY_REVIEW", "INSUFFICIENT_DATA"].includes(v)) return "warning";
    if (["HEALTHY", "SUFFICIENT"].includes(v)) return "success";
    return "info";
  }

  function chip(value) {
    return `<span class="axis-chip ${tone(value)}">${esc(value || "—")}</span>`;
  }

  function metric(label, value, hint, extra = "") {
    return `<article class="metric-card ${extra}"><div class="label">${esc(label)}</div><div class="value">${fmt(value)}</div><div class="hint">${esc(hint)}</div></article>`;
  }

  function apiUrl() {
    const base = state.gateway.replace(/\/+$/, "");
    const url = new URL(`${base}/v4/shadow/intelligence-v4-011`);
    url.searchParams.set("organization_id", state.organizationId);
    url.searchParams.set("limit", String(state.limit));
    url.searchParams.set("offset", String(state.offset));
    for (const [key, value] of Object.entries(state.filters)) if (value) url.searchParams.set(key, value);
    return url;
  }

  async function api() {
    if (!state.organizationId || !state.token) throw new Error("PREVIEW_SESSION_REQUIRED");
    const response = await fetch(apiUrl().toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${state.token}`,
        "x-organization-id": state.organizationId,
        "x-request-id": crypto.randomUUID()
      },
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP_${response.status}`);
    return body;
  }

  function drug(row) { return row.drugs || {}; }
  function warehouse(row) { return row.warehouses || {}; }

  function renderSummary(body) {
    const s = body.summary || {};
    const a1 = s.a1 || {};
    const b1 = s.b1 || {};
    metrics.innerHTML = [
      metric("Projected rows", body.projected_rows, "Operational keys preserved"),
      metric("A1 stockouts", a1.total, "OUT_OF_STOCK + insufficient evidence", "warning"),
      metric("A1 transfer", a1.transfer_review, "Human transfer review", "info"),
      metric("A1 procurement", a1.procurement_review, "Human procurement review", "danger"),
      metric("B1 expiry", b1.total, "Direct expiry evidence", "warning"),
      metric("Human reviews", s.human_review_recommendations, "No automatic execution")
    ].join("");

    cohortSummary.innerHTML = `
      <article class="cohort-card">
        <p class="eyebrow">A1 · factual stockout</p>
        <h3>${fmt(a1.total)} positions</h3>
        <p>${fmt(a1.transfer_review)} TRANSFER_REVIEW · ${fmt(a1.procurement_review)} PROCUREMENT_REVIEW</p>
        <div>${chip("OUT_OF_STOCK")} ${chip("INSUFFICIENT_DATA")}</div>
      </article>
      <article class="cohort-card">
        <p class="eyebrow">B1 · direct expiry evidence</p>
        <h3>${fmt(b1.total)} positions</h3>
        <p>CRITICAL ${fmt(b1.critical)} · HIGH ${fmt(b1.high)} · WARNING ${fmt(b1.warning)}</p>
        <div>${chip("TIME_WINDOW_ONLY")} ${chip("WASTAGE CLAIMS SUPPRESSED")}</div>
      </article>`;
  }

  function renderRows(body) {
    const rows = body.rows || [];
    if (!rows.length) {
      rowsRoot.innerHTML = `<div class="empty-state"><strong>Không có row phù hợp</strong><span>Thử bỏ bớt bộ lọc.</span></div>`;
      return;
    }
    rowsRoot.innerHTML = `<div class="table-wrap"><table class="multi-table"><thead><tr>
      <th>Mã thuốc</th><th>Kho</th><th>QOH / usable</th><th>Availability</th><th>Expiry</th><th>Evidence</th><th>Recommendation</th><th>Cohort</th><th>Legacy V4</th>
      </tr></thead><tbody>${rows.map((row) => {
        const d = drug(row); const w = warehouse(row);
        const human = row.recommendation_requires_human_review ? " · HUMAN" : "";
        return `<tr>
          <td><strong>${esc(d.drug_code || "—")}</strong><div class="subtle">${esc(d.name || "—")}</div></td>
          <td><strong>${esc(w.code || "—")}</strong><div class="subtle">${esc(w.name || "")}</div></td>
          <td class="numeric">${fmt(row.quantity_on_hand, 3)} / ${fmt(row.usable_quantity, 3)}</td>
          <td>${chip(row.availability_state)}<div class="reason-list">${(row.availability_reason_codes || []).map(esc).join(" · ")}</div></td>
          <td>${chip(row.expiry_state)}<div class="reason-list">${esc(row.expiry_evidence_mode || "NONE")}</div></td>
          <td>${chip(row.evidence_state)}<div class="reason-list">${(row.evidence_qualifiers || []).map(esc).join(" · ") || "—"}</div></td>
          <td>${chip(row.recommendation_state)}<div class="reason-list">${esc(human || "—")}</div></td>
          <td>${chip(row.approved_semantic_cohort)}</td>
          <td>${chip(row.legacy_v4_stock_status || "—")}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }

  function updatePagination() {
    const start = state.total ? state.offset + 1 : 0;
    const end = Math.min(state.offset + state.limit, state.total);
    pageInfo.textContent = `${fmt(start)}–${fmt(end)} / ${fmt(state.total)}`;
    $("prevButton").disabled = state.offset <= 0;
    $("nextButton").disabled = state.offset + state.limit >= state.total;
  }

  async function load() {
    $("refreshButton").disabled = true;
    statusBox.className = "multi-status";
    statusBox.textContent = "Đang tính V4_011 Shadow projection từ inventory_intelligence_v4…";
    try {
      const body = await api();
      state.total = Number(body.total || 0);
      renderSummary(body);
      renderRows(body);
      updatePagination();
      const a1 = body.summary?.a1 || {};
      const b1 = body.summary?.b1 || {};
      const accepted = body.projected_rows === 2244 && a1.total === 284 && a1.transfer_review === 39 && a1.procurement_review === 245 && b1.total === 19 && b1.critical === 3 && b1.high === 4 && b1.warning === 12 && b1.time_window_only === 19;
      statusBox.className = `multi-status ${accepted ? "success" : "warning"}`;
      statusBox.innerHTML = accepted
        ? `<strong>Acceptance invariants khớp.</strong> 2.244 keys · A1 284 = 39 + 245 · B1 19 = 3 + 4 + 12. Production semantics không thay đổi.`
        : `<strong>Cần review.</strong> Projection đã tải nhưng ít nhất một acceptance invariant không khớp snapshot đã duyệt.`;
    } catch (error) {
      const message = error?.message || String(error);
      statusBox.className = "multi-status error";
      statusBox.innerHTML = message === "PREVIEW_SESSION_REQUIRED"
        ? `Cần phiên preview đã đăng nhập. <a href="/login">Mở trang đăng nhập</a>.`
        : `Không tải được V4_011 Shadow: ${esc(message)}`;
      metrics.innerHTML = "";
      cohortSummary.innerHTML = "";
      rowsRoot.innerHTML = "";
      state.total = 0;
      updatePagination();
    } finally {
      $("refreshButton").disabled = false;
    }
  }

  for (const [id, key] of [["availabilityFilter", "availability"], ["expiryFilter", "expiry"], ["recommendationFilter", "recommendation"], ["cohortFilter", "cohort"]]) {
    $(id).addEventListener("change", (event) => {
      state.filters[key] = event.target.value;
      state.offset = 0;
      load();
    });
  }
  $("prevButton").addEventListener("click", () => { state.offset = Math.max(0, state.offset - state.limit); load(); });
  $("nextButton").addEventListener("click", () => { state.offset += state.limit; load(); });
  $("refreshButton").addEventListener("click", load);
  load();
})();
