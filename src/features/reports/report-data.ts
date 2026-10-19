import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { FinanceReadResult } from "@/features/finance/finance-read";
import {
  parseReportQuery,
  reportExportHref,
  reportFinanceFilters,
  type ReportParams,
  type ReportProject,
  type ReportTrend,
  type ReportWorkspaceData,
} from "./report-read";

function money(value: unknown, nonnegative = false): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER / 100 &&
    (!nonnegative || value >= 0)
  );
}

function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function decodeReportResult(value: unknown): FinanceReadResult {
  if (!value || typeof value !== "object") throw new Error("ReportReadUnavailable");
  const result = value as FinanceReadResult;
  if (
    !["ledger", "receivables"].includes(result.kind) ||
    !Number.isInteger(result.page) ||
    result.page < 1 ||
    result.pageSize !== 50 ||
    !Number.isSafeInteger(result.total) ||
    result.total < 0 ||
    !Array.isArray(result.rows) ||
    result.rows.length > result.total ||
    !result.summary ||
    typeof result.summary !== "object"
  )
    throw new Error("ReportReadUnavailable");
  const keys =
    result.kind === "ledger"
      ? ["income", "expense", "liability_in", "liability_out"]
      : ["receivable", "paid", "outstanding", "overdue"];
  if (keys.some((key) => !money(result.summary[key], result.kind === "receivables")))
    throw new Error("ReportReadUnavailable");
  const seen = new Set<string>();
  for (const row of result.rows) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      typeof row.id !== "string" ||
      !row.id ||
      seen.has(row.id) ||
      typeof row.category !== "string" ||
      !row.category ||
      !money(row.amount_xof, result.kind === "receivables") ||
      ["description", "title", "building_label", "unit_label"].some(
        (key) => row[key] != null && typeof row[key] !== "string",
      )
    )
      throw new Error("ReportReadUnavailable");
    seen.add(row.id);
    if (result.kind === "ledger") {
      if (
        !isoDate(row.entry_date) ||
        !["income", "expense", "liability_in", "liability_out"].includes(String(row.direction)) ||
        (row.amount_cny != null && !money(row.amount_cny))
      )
        throw new Error("ReportReadUnavailable");
    } else if (
      !isoDate(row.due_date) ||
      !money(row.paid_amount_xof, true) ||
      !["pending", "partial", "paid", "overdue", "cancelled"].includes(String(row.status)) ||
      !["managed", "historical_pending", "excluded"].includes(String(row.management_status))
    ) {
      throw new Error("ReportReadUnavailable");
    }
  }
  return result;
}

function decodeTrend(value: unknown, endMonth: string): ReportTrend[] {
  if (!Array.isArray(value) || value.length !== 12) throw new Error("ReportTrendUnavailable");
  const end = new Date(`${endMonth}-01T00:00:00Z`);
  return value.map((row, index) => {
    const date = new Date(end);
    date.setUTCMonth(date.getUTCMonth() - 11 + index);
    const expectedMonth = date.toISOString().slice(0, 7);
    if (
      !row ||
      typeof row !== "object" ||
      row.month !== expectedMonth ||
      [row.income, row.expense, row.net].some((amount) => !money(amount)) ||
      Math.abs(row.income - row.expense - row.net) >
        Math.max(
          0.000001,
          Math.max(Math.abs(row.income), Math.abs(row.expense), Math.abs(row.net)) *
            Number.EPSILON *
            4,
        )
    )
      throw new Error("ReportTrendUnavailable");
    return { month: row.month, income: row.income, expense: row.expense, net: row.net };
  });
}

export async function loadReportData(params: ReportParams = {}): Promise<ReportWorkspaceData> {
  const asOf = new Date().toISOString().slice(0, 10);
  parseReportQuery(params, asOf);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id,code,display_name")
    .eq("is_active", true)
    .order("code");
  if (error || !data) throw new Error("ReportProjectsUnavailable");
  const projects = data as ReportProject[];
  if (!projects.length) throw new Error("ReportNoAuthorizedProjects");
  const defaultProject =
    projects.find((project) => project.code.toUpperCase() === "SACSI") ?? projects[0];
  const query = parseReportQuery(params, asOf, defaultProject.id);
  if (!projects.some((project) => project.id === query.projectId))
    throw new Error("ReportProjectPermissionDenied");

  const [read, trendRead] = await Promise.all([
    supabase.rpc("finance_read_rpc", {
      p_kind: query.kind,
      p_filters: reportFinanceFilters(query),
      p_page: query.page,
    }),
    query.kind === "ledger"
      ? supabase.rpc("reports_trend_rpc", {
          p_project_id: query.projectId,
          p_end_month: `${query.month}-01`,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (read.error || trendRead.error) throw new Error("ReportReadUnavailable");
  const result = decodeReportResult(read.data);
  const expectedRows = Math.min(50, Math.max(0, result.total - (query.page - 1) * 50));
  if (
    result.kind !== query.kind ||
    result.page !== query.page ||
    result.rows.length !== expectedRows
  )
    throw new Error("ReportReadScopeMismatch");
  const trend = query.kind === "ledger" ? decodeTrend(trendRead.data, query.month) : [];
  return { query, projects, result, trend, asOf, exportHref: reportExportHref(query) };
}
