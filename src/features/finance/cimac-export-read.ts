import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CIMAC_PROJECT_ID,
  decodeCimacLedger,
  decodeCimacReceivables,
  type CimacExportQuery,
} from "./cimac-export-model";

export class CimacExportReadError extends Error {
  constructor(public readonly status: 403 | 413 | 503) {
    super("CIMAC export unavailable");
  }
}

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const paymentColumns =
  "id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,native_settlement,receipt_no,external_receipt_no,reversal_of_payment_id,payment_method";
type Row = Record<string, unknown>;
type ReadClient = Pick<SupabaseClient, "from" | "rpc">;

function fail(error: { code?: string; message?: string } | null): never {
  throw new CimacExportReadError(
    error?.code === "42501" ? 403 : error?.message === "exportTooLarge" ? 413 : 503,
  );
}

function ids(rows: Row[], key: string): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (value === null) continue;
    if (typeof value !== "string" || !uuid.test(value)) throw new CimacExportReadError(503);
    values.add(value);
  }
  return [...values];
}

async function related(
  client: ReadClient,
  table: "payments" | "units" | "buildings",
  columns: string,
  keys: string[],
): Promise<Row[]> {
  const result: Row[] = [];
  // Small explicit batches avoid the Data API's default row cap. Missing or
  // duplicate authorized references are an error, never a partial download.
  for (let offset = 0; offset < keys.length; offset += 100) {
    const chunk = keys.slice(offset, offset + 100);
    const { data, error } = await client.from(table).select(columns).in("id", chunk);
    if (error) fail(error);
    if (!Array.isArray(data) || data.length !== chunk.length) fail(null);
    const expected = new Set(chunk);
    for (const row of data as unknown as Row[]) {
      if (typeof row.id !== "string" || !expected.delete(row.id)) fail(null);
      result.push(row);
    }
    if (expected.size) fail(null);
  }
  return result;
}

/** Reads only the verified user's fixed CIMAC scope. Never uses service-role credentials. */
export async function readCimacExport(client: ReadClient, query: CimacExportQuery) {
  const { data: project, error: projectError } = await client
    .from("projects")
    .select("id,code")
    .eq("id", CIMAC_PROJECT_ID)
    .eq("code", "CIMAC")
    .eq("is_active", true)
    .maybeSingle();
  if (projectError) fail(projectError);
  if (!project || project.id !== CIMAC_PROJECT_ID || project.code !== "CIMAC")
    throw new CimacExportReadError(403);

  const isReceivable = query.view === "property-fee-receivables";
  const filters: Record<string, string> = { projectId: CIMAC_PROJECT_ID };
  if (query.dateFrom) filters.dateFrom = query.dateFrom;
  if (query.dateTo) filters.dateTo = query.dateTo;
  if (isReceivable) {
    filters.category = "property_fee";
    filters.management = "all";
  }
  const { data, error } = await client.rpc("finance_read_rpc", {
    p_kind: isReceivable ? "receivables" : "ledger",
    p_filters: filters,
    p_page: 1,
    p_export: true,
  });
  if (error) fail(error);
  const ledger = isReceivable ? [] : decodeCimacLedger(data);
  const receivables = isReceivable ? decodeCimacReceivables(data) : [];
  const principal = isReceivable ? receivables : ledger;
  const payments = isReceivable
    ? []
    : await related(client, "payments", paymentColumns, ids(ledger, "payment_id"));
  const unitIds = [...new Set([...ids(principal, "unit_id"), ...ids(payments, "unit_id")])];
  const units = await related(client, "units", "id,unit_no,building_id", unitIds);
  const buildingIds = [
    ...new Set([...ids(principal, "building_id"), ...ids(units, "building_id")]),
  ];
  const buildings = await related(client, "buildings", "id,project_id,display_name", buildingIds);
  if (buildings.some((building) => building.project_id !== CIMAC_PROJECT_ID)) fail(null);
  // The RPC values are the principal read snapshot; supplementary lookups
  // occur afterwards, so this is deliberately not called an atomic DB export.
  return { readAt: new Date().toISOString(), ledger, payments, units, buildings, receivables };
}
