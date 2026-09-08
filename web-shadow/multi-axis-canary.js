(() => {
  "use strict";

  const config = window.MEICARE_SHADOW_CONFIG || {};
  const state = {
    gateway: config.gatewayUrl || sessionStorage.getItem("meicare.shadow.gateway") || location.origin,
    organizationId: config.organizationId || window.MEICARE_SESSION.selectedOrganizationId()
  };

  const $ = (id) => document.getElementById(id);

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

  function metric(label, value, hint, extra = "") {
    return `<article class="metric-card ${extra}"><div class="label">${esc(label)}</div><div class="value">${fmt(value)}</div><div class="hint">${esc(hint)}</div></article>`;
  }

  function chip(value, tone = "info") {
    return `<span class="axis-chip ${tone}">${esc(value || "—")}</span>`;
  }

  async function api() {
    if (!state.organizationId) throw new Error("PREVIEW_SESSION_REQUIRED");
    const base = state.gateway.replace(/\/+$/, "");
    const url = new URL(`${base}/v4/shadow/intelligence-v4-011-canary`);
    url.searchParams.set("organization_id", state.organizationId);
    url.searchParams.set("limit", "50");
    const response = await window.MEICARE_SESSION.authorizedFetch(url.toString(), {
      method: "GET",
      headers: {
        "x-organization-id": state.organizationId,
        "x-request-id": crypto.randomUUID(),
        "x-meicare-canary": "V4_011C"
      },
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP_${response.status}`);
    return body;
  }

  function render(body) {
    const summary = body.db_summary || {};
    const a1 = summary.a1 || {};
    const b1 = summary.b1 || {};
    const parity = body.parity || {};
    $("metrics").innerHTML = [
      metric("DB rows", summary.rows, "Direct production projection"),
      metric("QOH", summary.quantity_on_hand_sum, "Read-only aggregate"),
      metric("A1", a1.total, `${fmt(a1.transfer_review)} transfer · ${fmt(a1.procurement_review)} procurement`, "warning"),
      metric("B1", b1.total, `${fmt(b1.critical)} critical · ${fmt(b1.high)} high · ${fmt(b1.warning)} warning`, "warning"),
      metric("Parity mismatch", parity.rows_with_mismatch, "DB vs Cloudflare projection", parity.exact_parity ? "" : "danger"),
      metric("Unsafe recommendations", summary.recommendations_without_human_review, "Must remain zero", summary.recommendations_without_human_review ? "danger" : "")
    ].join("");

    const fieldRows = Object.entries(parity.mismatch_by_field || {}).map(([field, count]) =>
      `<tr><td>${esc(field)}</td><td class="numeric">${fmt(count)}</td></tr>`
    ).join("");
    const samples = parity.sample_mismatches || [];
    $("parityRoot").innerHTML = `
      <div class="cohort-grid">
        <article class="cohort-card"><p class="eyebrow">Primary</p><h3>Database projection</h3><p>${esc(body.primary_read_path)}</p>${chip("HUMAN JWT + RLS", "success")}</article>
        <article class="cohort-card"><p class="eyebrow">Comparison</p><h3>Cloudflare projection</h3><p>${esc(body.comparison_read_path)}</p>${chip(parity.exact_parity ? "EXACT PARITY" : "MISMATCH", parity.exact_parity ? "success" : "danger")}</article>
      </div>
      <div class="table-wrap"><table class="multi-table"><thead><tr><th>Compared field</th><th>Mismatch rows</th></tr></thead><tbody>${fieldRows}</tbody></table></div>
      ${samples.length ? `<pre class="code-block">${esc(JSON.stringify(samples, null, 2))}</pre>` : `<div class="empty-state"><strong>Không có mismatch sample</strong><span>Hai read path đang khớp trên các field canary.</span></div>`}`;

    const rows = body.rows || [];
    $("rowsRoot").innerHTML = `<div class="table-wrap"><table class="multi-table"><thead><tr>
      <th>Warehouse ID</th><th>Drug ID</th><th>QOH / usable</th><th>Availability</th><th>Expiry</th><th>Evidence</th><th>Recommendation</th><th>Cohort</th>
      </tr></thead><tbody>${rows.map((row) => `<tr>
        <td>${esc(row.warehouse_id)}</td><td>${esc(row.drug_id)}</td><td class="numeric">${fmt(row.quantity_on_hand, 3)} / ${fmt(row.usable_quantity, 3)}</td>
        <td>${chip(row.availability_state)}</td><td>${chip(row.expiry_state)}</td><td>${chip(row.evidence_state)}</td><td>${chip(row.recommendation_state)}</td><td>${chip(row.approved_semantic_cohort)}</td>
      </tr>`).join("")}</tbody></table></div>`;

    const accepted = body.canary_pass === true && parity.exact_parity === true && summary.recommendations_without_human_review === 0;
    $("statusBox").className = `multi-status ${accepted ? "success" : "warning"}`;
    $("statusBox").innerHTML = accepted
      ? `<strong>V4_011C canary PASS.</strong> Database read path và Cloudflare projection khớp chính xác trên ${fmt(parity.matched_keys)} operational keys. Snapshot reference: ${body.snapshot_reference_match ? "MATCH" : "CHANGED"}.`
      : `<strong>V4_011C cần review.</strong> Canary không tự cutover. Mismatch rows: ${fmt(parity.rows_with_mismatch)} · missing DB: ${fmt(parity.missing_in_db)} · missing Cloudflare: ${fmt(parity.missing_in_cloud)}.`;
  }

  async function load() {
    $("refreshButton").disabled = true;
    $("statusBox").className = "multi-status";
    $("statusBox").textContent = "Đang đọc database projection và chạy parity check…";
    try {
      render(await api());
    } catch (error) {
      const message = error?.message || String(error);
      $("statusBox").className = "multi-status error";
      $("statusBox").innerHTML = message === "PREVIEW_SESSION_REQUIRED"
        ? `Cần phiên preview đã đăng nhập. <a href="/login">Mở trang đăng nhập</a>.`
        : `Không chạy được V4_011C canary: ${esc(message)}`;
      $("metrics").innerHTML = "";
      $("parityRoot").innerHTML = "";
      $("rowsRoot").innerHTML = "";
    } finally {
      $("refreshButton").disabled = false;
    }
  }

  $("refreshButton").addEventListener("click", load);
  load();
})();
