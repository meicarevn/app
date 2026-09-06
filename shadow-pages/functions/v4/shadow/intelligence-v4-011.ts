import { HttpError, requestId } from "../../../../src/lib";
import { getShadowAccess, shadowOrganizationId } from "../../../../src/shadow-access";
import { hydratePromotedDbRows, promotedMetadataComplete, summarizePromotedDbRows } from "../../../../src/intelligence-v4-011-db-read";

type Env = Record<string, never>;
type PagesContext = { request: Request; env: Env };
type Row = Record<string, unknown>;

const SUPABASE_URL = "https://sgxufmcsnveyyddazwuk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_9xbWYiMtnriBmFwuiGp8Qw_FNTB8NFc";
const MAX_ROWS = 5000;
const PAGE_SIZE = 1000;

function bearer(req: Request) {
  const value = req.headers.get("authorization") || "";
  if (!value.startsWith("Bearer ")) throw new HttpError(401, "UNAUTHORIZED");
  return value.slice(7);
}

function boundedInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new HttpError(400, "INVALID_PAGINATION");
  return parsed;
}

function json(body: unknown, status: number, rid: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-request-id": rid,
      "x-meicare-read-path": "V4_011D2_DB_PROJECTION"
    }
  });
}

async function fetchAll(
  req: Request,
  rid: string,
  table: string,
  org: string,
  select: string,
  order: string
): Promise<Row[]> {
  const token = bearer(req);
  const rows: Row[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set("organization_id", `eq.${org}`);
    url.searchParams.set("select", select);
    url.searchParams.set("order", order);
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${token}`,
        accept: "application/json",
        range: `${offset}-${offset + PAGE_SIZE - 1}`,
        "x-request-id": rid,
        "x-meicare-read-path": "V4_011D2_DB_PROJECTION"
      },
      cache: "no-store"
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: "v4_011_promoted_read_failed", table, status: response.status, request_id: rid }));
      throw new HttpError(response.status === 401 || response.status === 403 ? response.status : 502, "V4_011_SHADOW_READ_FAILED");
    }
    const page = await response.json() as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  if (rows.length >= MAX_ROWS) throw new HttpError(409, "V4_011_ROW_LIMIT_EXCEEDED");
  return rows;
}

const DB_SELECT = [
  "organization_id","warehouse_id","drug_id","analytics_run_id","quantity_on_hand","usable_quantity",
  "quantity_reserved","quantity_quarantined","quantity_rejected","expired_quantity","near_expiry_quantity",
  "inventory_value","unpriced_lot_count","organization_usable_quantity","forecast_daily_demand","demand_pattern",
  "demand_confidence_level","data_quality_score","days_of_supply","last_true_issue_at","inactive_days",
  "slow_moving_status","approved_min_stock","approved_reorder_point","approved_target_stock","approved_max_stock",
  "reference_stock","reference_basis","suggested_target_stock","recommended_order_quantity","expiry_quantity_at_risk",
  "expiry_value_at_risk","highest_expiry_risk","availability_state","availability_reason_codes","expiry_state",
  "expiry_reason_codes","expiry_evidence_mode","evidence_state","evidence_qualifiers","recommendation_state",
  "recommendation_reason_codes","recommendation_requires_human_review","suppress_expected_wastage_claims",
  "supported_expiry_quantity_at_risk","supported_expiry_value_at_risk","legacy_v4_stock_status",
  "legacy_v4_risk_score","legacy_v4_risk_components","legacy_v4_recommendation_basis","calculated_at","model_version"
].join(",");

const DRUG_SELECT = [
  "id","drug_code","name","generic_name","strength","unit","abc_class","ved_class","cold_chain_flag","controlled_flag"
].join(",");

const WAREHOUSE_SELECT = ["id","code","name"].join(",");

function matches(row: Record<string, unknown>, url: URL) {
  const availability = url.searchParams.get("availability")?.trim().toUpperCase();
  const expiry = url.searchParams.get("expiry")?.trim().toUpperCase();
  const evidence = url.searchParams.get("evidence")?.trim().toUpperCase();
  const recommendation = url.searchParams.get("recommendation")?.trim().toUpperCase();
  const cohort = url.searchParams.get("cohort")?.trim().toUpperCase();
  if (availability && row.availability_state !== availability) return false;
  if (expiry && row.expiry_state !== expiry) return false;
  if (evidence && row.evidence_state !== evidence) return false;
  if (recommendation && row.recommendation_state !== recommendation) return false;
  if (cohort && row.approved_semantic_cohort !== cohort) return false;
  return true;
}

async function handle(context: PagesContext) {
  const req = context.request;
  const rid = requestId(req);
  try {
    if (req.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED");
    const url = new URL(req.url);
    const org = shadowOrganizationId(req, url);
    const access = await getShadowAccess(req, { SUPABASE_URL, SUPABASE_ANON_KEY }, rid, org);
    if (!access.permissions.includes("inventory.view")) throw new HttpError(403, "SHADOW_PERMISSION_DENIED");
    if (!access.organization_scope) throw new HttpError(403, "SHADOW_SCOPE_DENIED");

    const [dbRows, drugs, warehouses] = await Promise.all([
      fetchAll(req, rid, "inventory_intelligence_multi_axis_v4_011", org, DB_SELECT, "warehouse_id.asc,drug_id.asc"),
      fetchAll(req, rid, "drugs", org, DRUG_SELECT, "id.asc"),
      fetchAll(req, rid, "warehouses", org, WAREHOUSE_SELECT, "id.asc")
    ]);

    const projected = hydratePromotedDbRows(dbRows, drugs, warehouses);
    if (!promotedMetadataComplete(projected)) throw new HttpError(502, "V4_011_METADATA_INCOMPLETE");
    const summary = summarizePromotedDbRows(projected);
    if (summary.recommendations_without_human_review !== 0) throw new HttpError(409, "V4_011_UNSAFE_RECOMMENDATION_STATE");

    const filtered = projected.filter((row) => matches(row, url));
    const limit = boundedInt(url.searchParams.get("limit"), 100, 1, 250);
    const offset = boundedInt(url.searchParams.get("offset"), 0, 0, 10000);

    return json({
      mode: "SHADOW",
      read_only: true,
      organization_id: org,
      generated_at: new Date().toISOString(),
      model_version: "V4_011_MULTI_AXIS",
      source_model: "inventory_intelligence_multi_axis_v4_011",
      read_path: "DB_PROJECTION",
      promotion_gate: "V4_011D2",
      organization_scope_required: true,
      source_rows: dbRows.length,
      projected_rows: projected.length,
      total: filtered.length,
      limit,
      offset,
      summary,
      rows: filtered.slice(offset, offset + limit)
    }, 200, rid);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code, request_id: rid }, error.status, rid);
    console.error(JSON.stringify({ event: "v4_011_shadow_unhandled", request_id: rid }));
    return json({ error: "V4_011_SHADOW_FAILED", request_id: rid }, 500, rid);
  }
}

export const onRequest = handle;
