import { HttpError, requestId } from "../../../../src/lib";
import { getShadowAccess, shadowOrganizationId } from "../../../../src/shadow-access";
import { projectMultiAxisRows } from "../../../../src/intelligence-v4-011";
import { approvedCohort, compareMultiAxisReadPaths, summarizeDbProjection } from "../../../../src/intelligence-v4-011-canary";

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
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-request-id": rid,
      "x-meicare-canary": "V4_011C"
    }
  });
}

async function fetchAll(req: Request, rid: string, table: string, org: string, select: string): Promise<Row[]> {
  const token = bearer(req);
  const rows: Row[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set("organization_id", `eq.${org}`);
    url.searchParams.set("select", select);
    url.searchParams.set("order", "warehouse_id.asc,drug_id.asc");
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${token}`,
        accept: "application/json",
        range: `${offset}-${offset + PAGE_SIZE - 1}`,
        "x-request-id": rid,
        "x-meicare-canary": "V4_011C"
      },
      cache: "no-store"
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: "v4_011c_read_failed", table, status: response.status, request_id: rid }));
      throw new HttpError(response.status === 401 || response.status === 403 ? response.status : 502, "V4_011C_READ_FAILED");
    }
    const page = await response.json() as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  if (rows.length >= MAX_ROWS) throw new HttpError(409, "V4_011C_ROW_LIMIT_EXCEEDED");
  return rows;
}

const DB_SELECT = [
  "organization_id","warehouse_id","drug_id","quantity_on_hand","usable_quantity",
  "availability_state","expiry_state","evidence_state","recommendation_state",
  "expiry_evidence_mode","recommendation_requires_human_review","suppress_expected_wastage_claims",
  "legacy_v4_stock_status","supported_expiry_quantity_at_risk","supported_expiry_value_at_risk",
  "model_version","calculated_at"
].join(",");

const CLOUD_SOURCE_SELECT = [
  "organization_id","warehouse_id","drug_id","quantity_on_hand","usable_quantity",
  "forecast_daily_demand","last_true_issue_at","reference_stock","reference_basis",
  "unpriced_lot_count","highest_expiry_risk","near_expiry_quantity","expiry_quantity_at_risk",
  "expiry_value_at_risk","stock_status","calculated_at"
].join(",");

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

    const [dbRows, cloudSourceRows] = await Promise.all([
      fetchAll(req, rid, "inventory_intelligence_multi_axis_v4_011", org, DB_SELECT),
      fetchAll(req, rid, "inventory_intelligence_v4", org, CLOUD_SOURCE_SELECT)
    ]);
    const cloudRows = projectMultiAxisRows(cloudSourceRows);
    const parity = compareMultiAxisReadPaths(dbRows, cloudRows);
    const summary = summarizeDbProjection(dbRows);
    const limit = boundedInt(url.searchParams.get("limit"), 100, 1, 250);
    const offset = boundedInt(url.searchParams.get("offset"), 0, 0, 10000);
    const rows = dbRows.slice(offset, offset + limit).map((row) => ({ ...row, approved_semantic_cohort: approvedCohort(row) }));

    const snapshotReferenceMatch = dbRows.length === 2244
      && summary.a1.total === 284
      && summary.a1.transfer_review === 39
      && summary.a1.procurement_review === 245
      && summary.b1.total === 19
      && summary.b1.critical === 3
      && summary.b1.high === 4
      && summary.b1.warning === 12
      && summary.b1.time_window_only === 19;

    return json({
      mode: "SHADOW_CANARY",
      read_only: true,
      canary: "V4_011C",
      organization_id: org,
      generated_at: new Date().toISOString(),
      primary_read_path: "inventory_intelligence_multi_axis_v4_011",
      comparison_read_path: "inventory_intelligence_v4 + Cloudflare projectMultiAxisRows",
      organization_scope_required: true,
      db_summary: summary,
      parity,
      snapshot_reference_match: snapshotReferenceMatch,
      canary_pass: parity.exact_parity && summary.recommendations_without_human_review === 0,
      total: dbRows.length,
      limit,
      offset,
      rows
    }, 200, rid);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code, request_id: rid }, error.status, rid);
    console.error(JSON.stringify({ event: "v4_011c_unhandled", request_id: rid }));
    return json({ error: "V4_011C_CANARY_FAILED", request_id: rid }, 500, rid);
  }
}

export const onRequest = handle;
