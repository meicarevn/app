import { HttpError } from "./lib";

type ShadowEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
};

type JsonObject = Record<string, unknown>;

type RestList<T = JsonObject> = {
  rows: T[];
  total: number | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function boundedInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new HttpError(400, "INVALID_PAGINATION");
  return parsed;
}

function organizationId(req: Request, url: URL) {
  const value = (url.searchParams.get("organization_id") || req.headers.get("x-organization-id") || "").trim();
  if (!UUID_RE.test(value)) throw new HttpError(400, "ORGANIZATION_ID_REQUIRED");
  return value;
}

async function verifyUser(req: Request, env: ShadowEnv, rid: string) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "UNAUTHORIZED");
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      "x-request-id": rid
    }
  });
  if (!res.ok) throw new HttpError(401, "UNAUTHORIZED");
  const user = await res.json() as { id?: unknown };
  if (typeof user.id !== "string") throw new HttpError(401, "UNAUTHORIZED");
  return { token, userId: user.id };
}

function contentRangeTotal(value: string | null) {
  if (!value) return null;
  const match = value.match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") return null;
  return Number(match[1]);
}

async function restList<T = JsonObject>(
  env: ShadowEnv,
  token: string,
  rid: string,
  table: string,
  params: Record<string, string>,
  limit = 50,
  offset = 0
): Promise<RestList<T>> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url.toString(), {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      accept: "application/json",
      prefer: "count=exact",
      range: `${offset}-${offset + limit - 1}`,
      "x-request-id": rid
    }
  });
  if (!res.ok) {
    console.error(JSON.stringify({ event: "shadow_rest_failed", table, status: res.status, request_id: rid }));
    throw new HttpError(res.status === 401 || res.status === 403 ? res.status : 502, "SHADOW_READ_FAILED");
  }
  return {
    rows: await res.json() as T[],
    total: contentRangeTotal(res.headers.get("content-range"))
  };
}

async function restCount(
  env: ShadowEnv,
  token: string,
  rid: string,
  table: string,
  params: Record<string, string>
) {
  const result = await restList(env, token, rid, table, { ...params, select: "organization_id" }, 1, 0);
  return result.total ?? result.rows.length;
}

async function restAll<T = JsonObject>(
  env: ShadowEnv,
  token: string,
  rid: string,
  table: string,
  params: Record<string, string>,
  maxRows = 5000
) {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await restList<T>(env, token, rid, table, params, pageSize, offset);
    rows.push(...page.rows);
    if (page.rows.length < pageSize || (page.total != null && rows.length >= page.total)) break;
  }
  if (rows.length >= maxRows) throw new HttpError(409, "SHADOW_COMPARE_ROW_LIMIT_EXCEEDED");
  return rows;
}

function listEnvelope<T>(kind: string, org: string, result: RestList<T>, limit: number, offset: number) {
  return {
    mode: "SHADOW",
    kind,
    organization_id: org,
    limit,
    offset,
    total: result.total,
    rows: result.rows
  };
}

async function overview(env: ShadowEnv, token: string, rid: string, org: string) {
  const orgFilter = { organization_id: `eq.${org}` };
  const [readiness, totalPositions, outOfStock, critical, reorder, expiryRisk, insufficient, actions, reconciliations, iot, documents] = await Promise.all([
    restList(env, token, rid, "production_readiness_v4", { ...orgFilter, select: "*" }, 1, 0),
    restCount(env, token, rid, "inventory_intelligence_v4", orgFilter),
    restCount(env, token, rid, "inventory_intelligence_v4", { ...orgFilter, stock_status: "eq.OUT_OF_STOCK" }),
    restCount(env, token, rid, "inventory_intelligence_v4", { ...orgFilter, stock_status: "eq.CRITICAL" }),
    restCount(env, token, rid, "inventory_intelligence_v4", { ...orgFilter, stock_status: "eq.REORDER" }),
    restCount(env, token, rid, "inventory_intelligence_v4", { ...orgFilter, stock_status: "eq.EXPIRY_RISK" }),
    restCount(env, token, rid, "inventory_intelligence_v4", { ...orgFilter, stock_status: "eq.INSUFFICIENT_DATA" }),
    restCount(env, token, rid, "action_center_v4", orgFilter),
    restCount(env, token, rid, "inventory_reconciliation_summary_v4", orgFilter),
    restCount(env, token, rid, "iot_health_v4", orgFilter),
    restCount(env, token, rid, "document_registry_summary_v4", orgFilter)
  ]);

  return {
    mode: "SHADOW",
    organization_id: org,
    generated_at: new Date().toISOString(),
    readiness: readiness.rows[0] ?? null,
    inventory: {
      positions: totalPositions,
      out_of_stock: outOfStock,
      critical: critical,
      reorder: reorder,
      expiry_risk: expiryRisk,
      insufficient_data: insufficient,
      actionable: outOfStock + critical + reorder + expiryRisk
    },
    action_center: { items: actions },
    reconciliation: { runs: reconciliations },
    iot: { devices: iot },
    documents: { documents }
  };
}

async function inventory(req: Request, env: ShadowEnv, token: string, rid: string, org: string, url: URL) {
  const limit = boundedInt(url.searchParams.get("limit"), 50, 1, 200);
  const offset = boundedInt(url.searchParams.get("offset"), 0, 0, 10000);
  const params: Record<string, string> = {
    organization_id: `eq.${org}`,
    select: "organization_id,warehouse_id,drug_id,quantity_on_hand,usable_quantity,quantity_reserved,quantity_quarantined,quantity_rejected,expired_quantity,near_expiry_quantity,inventory_value,unpriced_lot_count,forecast_daily_demand,demand_pattern,demand_confidence_level,data_quality_score,days_of_supply,last_true_issue_at,inactive_days,slow_moving_status,reference_stock,reference_basis,suggested_target_stock,recommended_order_quantity,expiry_quantity_at_risk,expiry_value_at_risk,highest_expiry_risk,stock_status,risk_score,recommendation_basis,calculated_at,drugs!inventory_intelligence_v4_drug_id_fkey(drug_code,name,generic_name,strength,unit,abc_class,ved_class,cold_chain_flag,controlled_flag),warehouses!inventory_intelligence_v4_warehouse_id_fkey(code,name)",
    order: "risk_score.desc.nullslast,calculated_at.desc"
  };
  const status = url.searchParams.get("status")?.trim().toUpperCase();
  if (status) params.stock_status = `eq.${status}`;
  const result = await restList(env, token, rid, "inventory_intelligence_v4", params, limit, offset);
  return listEnvelope("inventory", org, result, limit, offset);
}

async function actions(env: ShadowEnv, token: string, rid: string, org: string, url: URL) {
  const limit = boundedInt(url.searchParams.get("limit"), 50, 1, 200);
  const offset = boundedInt(url.searchParams.get("offset"), 0, 0, 10000);
  const params: Record<string, string> = {
    organization_id: `eq.${org}`,
    select: "organization_id,item_kind,item_id,alert_id,source_type,source_id,warehouse_id,drug_id,drug_lot_id,title,description,priority,status,owner_user_id,owner_membership_id,due_at,created_at,triggered_at,reason_code,recommended_action,engine_version,risk_score,metadata",
    order: "risk_score.desc.nullslast,created_at.desc"
  };
  const result = await restList(env, token, rid, "action_center_v4", params, limit, offset);
  return listEnvelope("actions", org, result, limit, offset);
}

async function reconciliations(env: ShadowEnv, token: string, rid: string, org: string, url: URL) {
  const limit = boundedInt(url.searchParams.get("limit"), 30, 1, 100);
  const offset = boundedInt(url.searchParams.get("offset"), 0, 0, 10000);
  const result = await restList(env, token, rid, "inventory_reconciliation_summary_v4", {
    organization_id: `eq.${org}`,
    select: "*",
    order: "observed_at.desc.nullslast,reconciliation_at.desc.nullslast"
  }, limit, offset);
  return listEnvelope("reconciliations", org, result, limit, offset);
}

async function iotHealth(env: ShadowEnv, token: string, rid: string, org: string, url: URL) {
  const limit = boundedInt(url.searchParams.get("limit"), 100, 1, 200);
  const offset = boundedInt(url.searchParams.get("offset"), 0, 0, 10000);
  const result = await restList(env, token, rid, "iot_health_v4", {
    organization_id: `eq.${org}`,
    select: "*",
    order: "health_status.asc,last_seen_at.desc.nullslast"
  }, limit, offset);
  return listEnvelope("iot", org, result, limit, offset);
}

async function documents(env: ShadowEnv, token: string, rid: string, org: string, url: URL) {
  const limit = boundedInt(url.searchParams.get("limit"), 50, 1, 200);
  const offset = boundedInt(url.searchParams.get("offset"), 0, 0, 10000);
  const result = await restList(env, token, rid, "document_registry_summary_v4", {
    organization_id: `eq.${org}`,
    select: "id,organization_id,document_code,title,document_type,org_unit_id,org_unit_code,org_unit_name,classification,status,business_process,topic,tags,effective_date,review_date,retention_class,retention_until,legal_hold,owner_membership_id,current_version_id,current_version_number,current_checksum_sha256,latest_version_id,latest_version_number,latest_version_status,evidence_count,verified_evidence_count,unverified_evidence_count,pending_approvals,created_at,updated_at",
    order: "updated_at.desc"
  }, limit, offset);
  return listEnvelope("documents", org, result, limit, offset);
}

async function readiness(env: ShadowEnv, token: string, rid: string, org: string) {
  const result = await restList(env, token, rid, "production_readiness_v4", {
    organization_id: `eq.${org}`,
    select: "*"
  }, 1, 0);
  return {
    mode: "SHADOW",
    organization_id: org,
    readiness: result.rows[0] ?? null
  };
}

type InventoryCompareRow = {
  warehouse_id: string;
  drug_id: string;
  quantity_on_hand: number | string | null;
  usable_quantity: number | string | null;
  stock_status: string | null;
};

function numeric(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function compareInventory(env: ShadowEnv, token: string, rid: string, org: string) {
  const [v4, v3] = await Promise.all([
    restAll<InventoryCompareRow>(env, token, rid, "inventory_intelligence_v4", {
      organization_id: `eq.${org}`,
      select: "warehouse_id,drug_id,quantity_on_hand,usable_quantity,stock_status",
      order: "warehouse_id.asc,drug_id.asc"
    }),
    restAll<InventoryCompareRow>(env, token, rid, "inventory_management_v3_view", {
      organization_id: `eq.${org}`,
      scope_type: "eq.WAREHOUSE",
      select: "warehouse_id,drug_id,quantity_on_hand,usable_quantity,stock_status",
      order: "warehouse_id.asc,drug_id.asc"
    })
  ]);

  const key = (row: InventoryCompareRow) => `${row.warehouse_id}:${row.drug_id}`;
  const a = new Map(v3.map((row) => [key(row), row]));
  const b = new Map(v4.map((row) => [key(row), row]));
  const keys = new Set([...a.keys(), ...b.keys()]);
  let matched = 0;
  let missingV3 = 0;
  let missingV4 = 0;
  let quantityMismatch = 0;
  let statusMismatch = 0;
  let absoluteQuantityDelta = 0;
  const samples: JsonObject[] = [];

  for (const k of keys) {
    const oldRow = a.get(k);
    const newRow = b.get(k);
    if (!oldRow) { missingV3 += 1; if (samples.length < 20) samples.push({ key: k, mismatch: "MISSING_V3" }); continue; }
    if (!newRow) { missingV4 += 1; if (samples.length < 20) samples.push({ key: k, mismatch: "MISSING_V4" }); continue; }
    matched += 1;
    const delta = numeric(newRow.quantity_on_hand) - numeric(oldRow.quantity_on_hand);
    const statusDiff = (newRow.stock_status ?? null) !== (oldRow.stock_status ?? null);
    if (Math.abs(delta) > 0.000001) {
      quantityMismatch += 1;
      absoluteQuantityDelta += Math.abs(delta);
    }
    if (statusDiff) statusMismatch += 1;
    if ((Math.abs(delta) > 0.000001 || statusDiff) && samples.length < 20) {
      samples.push({
        key: k,
        quantity_v3: numeric(oldRow.quantity_on_hand),
        quantity_v4: numeric(newRow.quantity_on_hand),
        quantity_delta: delta,
        status_v3: oldRow.stock_status,
        status_v4: newRow.stock_status
      });
    }
  }

  return {
    mode: "SHADOW",
    organization_id: org,
    compared_at: new Date().toISOString(),
    v3_rows: v3.length,
    v4_rows: v4.length,
    matched_keys: matched,
    missing_in_v3: missingV3,
    missing_in_v4: missingV4,
    quantity_mismatch_count: quantityMismatch,
    quantity_absolute_delta: absoluteQuantityDelta,
    status_mismatch_count: statusMismatch,
    sample_mismatches: samples
  };
}

export async function handleShadowRead(req: Request, env: ShadowEnv, rid: string) {
  if (req.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED");
  const url = new URL(req.url);
  const { token } = await verifyUser(req, env, rid);
  const org = organizationId(req, url);

  if (url.pathname === "/v4/shadow/overview") return overview(env, token, rid, org);
  if (url.pathname === "/v4/shadow/inventory") return inventory(req, env, token, rid, org, url);
  if (url.pathname === "/v4/shadow/actions") return actions(env, token, rid, org, url);
  if (url.pathname === "/v4/shadow/reconciliations") return reconciliations(env, token, rid, org, url);
  if (url.pathname === "/v4/shadow/iot") return iotHealth(env, token, rid, org, url);
  if (url.pathname === "/v4/shadow/documents") return documents(env, token, rid, org, url);
  if (url.pathname === "/v4/shadow/readiness") return readiness(env, token, rid, org);
  if (url.pathname === "/v4/shadow/compare/inventory") return compareInventory(env, token, rid, org);
  throw new HttpError(404, "SHADOW_ROUTE_NOT_FOUND");
}
