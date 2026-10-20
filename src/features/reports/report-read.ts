import type { FinanceFilters, FinanceReadResult } from "@/features/finance/finance-read";
import {
  directionDisplayLabel,
  financialBusinessLabel,
  statusDisplayLabel,
} from "@/lib/display-labels";

export interface ReportQuery {
  kind: "ledger" | "receivables";
  projectId: string;
  month: string;
  page: number;
  search: string;
  direction: string;
  management: "managed" | "historical_pending" | "excluded";
  outstandingOnly: boolean;
}

export interface ReportProject {
  id: string;
  code: string;
  display_name: string;
}

/** Registered ledger entries, not an independently verified cash-flow statement. */
export interface ReportTrend {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export interface ReportWorkspaceData {
  query: ReportQuery;
  projects: ReportProject[];
  result: FinanceReadResult;
  trend: ReportTrend[];
  asOf: string;
  exportHref: string;
}

export type ReportParams = Record<string, string | string[] | undefined>;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function parseReportQuery(
  params: ReportParams,
  asOf = new Date().toISOString().slice(0, 10),
  defaultProjectId = "",
): ReportQuery {
  const one = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) throw new Error("Duplicate report filter");
    return value?.trim() ?? "";
  };
  const kind = one("kind") || "ledger";
  if (kind !== "ledger" && kind !== "receivables") throw new Error("Invalid report kind");
  const projectId = one("projectId") || defaultProjectId;
  if (projectId && !uuid.test(projectId)) throw new Error("Invalid report project");
  const month = one("month") || asOf.slice(0, 7);
  if (!/^(?:19|[2-9]\d)\d{2}-(?:0[1-9]|1[0-2])$/.test(month))
    throw new Error("Invalid report month");
  const page = Number(one("page") || "1");
  if (!Number.isInteger(page) || page < 1 || page > 2_000_000)
    throw new Error("Invalid report page");
  const search = one("search");
  if (search.length > 150) throw new Error("Report search too long");
  const direction = one("direction");
  if (direction && !["income", "expense", "liability_in", "liability_out"].includes(direction))
    throw new Error("Invalid report direction");
  const management = one("management") || "managed";
  if (!["managed", "historical_pending", "excluded"].includes(management))
    throw new Error("Invalid report management");
  const outstandingOnly = one("outstandingOnly");
  if (outstandingOnly && !["true", "false"].includes(outstandingOnly))
    throw new Error("Invalid report outstanding filter");
  return {
    kind,
    projectId,
    month,
    page,
    search,
    direction: kind === "ledger" ? direction : "",
    management: management as ReportQuery["management"],
    outstandingOnly: kind === "receivables" && outstandingOnly === "true",
  };
}

export function reportFinanceFilters(query: ReportQuery): FinanceFilters {
  if (!uuid.test(query.projectId)) throw new Error("Report project required");
  const filters: FinanceFilters = { projectId: query.projectId };
  if (query.search) filters.search = query.search;
  if (query.kind === "ledger") {
    filters.dateFrom = `${query.month}-01`;
    const [year, month] = query.month.split("-").map(Number);
    filters.dateTo = `${query.month}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
    if (query.direction) filters.direction = query.direction;
  } else {
    // These are current balances. A selected ledger month is never a historic
    // month-end snapshot and must not narrow receivables by their due date.
    filters.management = query.management;
    if (query.outstandingOnly) filters.outstandingOnly = "true";
  }
  return filters;
}

export function reportHref(query: ReportQuery, patch: Partial<ReportQuery> = {}) {
  const changedFilter = Object.keys(patch).some((key) => key !== "page");
  const next = { ...query, ...(changedFilter ? { page: 1 } : {}), ...patch };
  const params = new URLSearchParams({
    kind: next.kind,
    projectId: next.projectId,
    month: next.month,
    page: String(next.page),
  });
  if (next.search) params.set("search", next.search);
  if (next.kind === "ledger" && next.direction) params.set("direction", next.direction);
  if (next.kind === "receivables") {
    params.set("management", next.management);
    if (next.outstandingOnly) params.set("outstandingOnly", "true");
  }
  return `/reports?${params}`;
}

export function reportExportHref(query: ReportQuery) {
  return `/api/reports/export?${reportHref(query).split("?")[1]}`;
}

/** Exports all authorized filtered rows, never a client-side table page. */
export function reportCsv(result: FinanceReadResult, locale: "zh" | "fr" = "zh") {
  const zh = locale === "zh";
  const columns =
    result.kind === "ledger"
      ? [
          "entry_date",
          "building_label",
          "unit_label",
          "direction",
          "category",
          "amount_xof",
          "amount_cny",
          "description",
          "payment_id",
          "id",
        ]
      : [
          "due_date",
          "building_label",
          "unit_label",
          "category",
          "title",
          "amount_xof",
          "paid_amount_xof",
          "status",
          "management_status",
          "source_type",
          "source_id",
          "id",
        ];
  columns.push("currency", "amount_native");
  if (result.kind === "receivables") columns.push("paid_amount_native");
  const labels: Record<string, string> = zh
    ? {
        currency: "原币币种（独立结算）",
        amount_native: "原币金额（不并入XOF）",
        paid_amount_native: "原币已核销",
        entry_date: "登记日期",
        due_date: "到期日",
        building_label: "楼栋",
        unit_label: "房号",
        direction: "登记方向",
        category: "业务类别",
        amount_xof: "金额 XOF",
        amount_cny: "登记折算 CNY",
        description: "说明",
        payment_id: "关联付款 ID",
        id: "记录 ID",
        title: "事项",
        paid_amount_xof: "已核销 XOF",
        status: "状态",
        management_status: "管理范围",
        source_type: "来源类型",
        source_id: "来源 ID",
      }
    : {
        currency: "Devise indépendante",
        amount_native: "Montant en devise (hors XOF)",
        paid_amount_native: "Imputé en devise",
        entry_date: "Date d’écriture",
        due_date: "Échéance",
        building_label: "Bâtiment",
        unit_label: "Lot",
        direction: "Sens de l’écriture",
        category: "Catégorie",
        amount_xof: "Montant XOF",
        amount_cny: "Conversion enregistrée CNY",
        description: "Description",
        payment_id: "ID du paiement lié",
        id: "ID de l’écriture",
        title: "Objet",
        paid_amount_xof: "Imputé XOF",
        status: "Statut",
        management_status: "Périmètre de gestion",
        source_type: "Type de source",
        source_id: "ID de la source",
      };
  const managementLabels: Record<string, string> = zh
    ? { managed: "系统管理", historical_pending: "历史待核对", excluded: "已排除" }
    : { managed: "Gérées", historical_pending: "Historique à vérifier", excluded: "Exclues" };
  const cell = (value: string | number | null | undefined) => {
    const text = String(value ?? "");
    const safe = typeof value === "string" && /^\s*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      columns.map((column) => cell(labels[column])).join(","),
      ...result.rows.map((row) =>
        columns
          .map((column) => {
            const value = row[column];
            if (column === "direction")
              return cell(directionDisplayLabel(String(value ?? ""), locale));
            if (column === "category")
              return cell(financialBusinessLabel(String(value ?? ""), locale));
            if (column === "status") return cell(statusDisplayLabel(String(value ?? ""), locale));
            if (column === "management_status")
              return cell(managementLabels[String(value)] ?? String(value ?? ""));
            return cell(value);
          })
          .join(","),
      ),
    ].join("\r\n")
  );
}
