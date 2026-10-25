import { parseFinanceRead, type FinanceKind, type FinanceReadResult } from "./finance-read";
import { decodeNativeSummary, financeRowMoney } from "@/lib/native-money";

export type FinanceWorkbenchQuery = ReturnType<typeof parseFinanceRead>;
export type FinanceWorkbenchMode = FinanceKind | "reconciliation";
export interface FinanceProjectOption {
  id: string;
  code: string;
  display_name: string | null;
}
export interface FinanceBuildingOption {
  id: string;
  code: string;
  display_name: string | null;
  project_id: string | null;
}
export interface FinanceReconciliation {
  available: boolean;
  count: number | null;
  issues: { code: string; entity_id: string }[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("FinanceReadUnavailable");
  return value as Record<string, unknown>;
}
export function financeNumber(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)))
    throw new Error("FinanceReadUnavailable");
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER / 100)
    throw new Error("FinanceReadUnavailable");
  return number;
}
export function financeWorkbenchMode(
  params: Record<string, string | string[] | undefined>,
  kind: FinanceKind,
): FinanceWorkbenchMode {
  if (params.view === undefined || params.view === "") return kind;
  if (params.view !== "reconciliation") throw new Error("Invalid finance view");
  return "reconciliation";
}

/** Unknown amounts must fail closed, never silently become zero. */
export function decodeFinanceWorkbenchRead(
  value: unknown,
  kind: FinanceKind,
  page: number,
): FinanceReadResult {
  const data = object(value);
  if (
    data.kind !== kind ||
    data.page !== page ||
    data.pageSize !== 50 ||
    !Number.isSafeInteger(data.total) ||
    Number(data.total) < 0 ||
    !Array.isArray(data.rows) ||
    data.rows.length > 50 ||
    data.rows.length > Number(data.total)
  )
    throw new Error("FinanceReadUnavailable");
  const summary = object(data.summary);
  const keys =
    kind === "ledger"
      ? ["income", "expense", "liability_in", "liability_out"]
      : ["receivable", "paid", "outstanding", "overdue"];
  const numericSummary = Object.fromEntries(keys.map((key) => [key, financeNumber(summary[key])]));
  const seen = new Set<string>();
  const rows = data.rows.map((value) => {
    const row = object(value);
    if (typeof row.id !== "string" || !row.id || seen.has(row.id))
      throw new Error("FinanceReadUnavailable");
    seen.add(row.id);
    const date = row[kind === "ledger" ? "entry_date" : "due_date"];
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new Error("FinanceReadUnavailable");
    for (const key of ["building_label", "unit_label"])
      if (row[key] !== null && typeof row[key] !== "string")
        throw new Error("FinanceReadUnavailable");
    if (typeof row.category !== "string") throw new Error("FinanceReadUnavailable");
    if (
      kind === "ledger" &&
      !["income", "expense", "liability_in", "liability_out"].includes(String(row.direction))
    )
      throw new Error("FinanceReadUnavailable");
    if (
      kind === "receivables" &&
      (typeof row.status !== "string" || typeof row.management_status !== "string")
    )
      throw new Error("FinanceReadUnavailable");
    return {
      ...row,
      amount_xof: financeNumber(row.amount_xof),
      ...(kind === "receivables" ? { paid_amount_xof: financeNumber(row.paid_amount_xof) } : {}),
    } as FinanceReadResult["rows"][number];
  });
  return {
    kind,
    page,
    pageSize: 50,
    total: Number(data.total),
    summary: numericSummary,
    rows,
    nativeSummary: decodeNativeSummary(data.nativeSummary),
  };
}
export function decodeFinanceReconciliation(value: unknown): FinanceReconciliation {
  const row = object(value);
  if (
    !Number.isSafeInteger(row.count) ||
    Number(row.count) < 0 ||
    !Array.isArray(row.issues) ||
    row.issues.length > 100 ||
    row.issues.length > Number(row.count) ||
    (Number(row.count) > 0 && row.issues.length === 0)
  )
    throw new Error("FinanceReconciliationUnavailable");
  const issues = row.issues.map((value) => {
    const issue = object(value);
    if (
      typeof issue.code !== "string" ||
      !issue.code ||
      typeof issue.entity_id !== "string" ||
      !issue.entity_id
    )
      throw new Error("FinanceReconciliationUnavailable");
    return { code: issue.code, entity_id: issue.entity_id };
  });
  return { available: true, count: Number(row.count), issues };
}
export function financeWorkbenchHref(
  query: FinanceWorkbenchQuery,
  locale: "zh" | "fr",
  mode: FinanceWorkbenchMode,
  patch: Record<string, string | undefined> = {},
  workArea: "sacsi" | "cimac" = "sacsi",
): string {
  const kind = mode === "reconciliation" ? query.kind : mode;
  const parameters = new URLSearchParams({ ...query.filters, kind });
  if (query.page > 1) parameters.set("page", String(query.page));
  if (mode !== query.kind) parameters.delete("page");
  for (const [key, value] of Object.entries(patch)) {
    if (value) parameters.set(key, value);
    else parameters.delete(key);
  }
  const parsed = parseFinanceRead(Object.fromEntries(parameters));
  const clean = new URLSearchParams({ ...parsed.filters, kind: parsed.kind });
  if (parsed.page > 1) clean.set("page", String(parsed.page));
  if (mode === "reconciliation") clean.set("view", "reconciliation");
  return `${locale === "fr" ? "/fr" : ""}${workArea === "cimac" ? "/cimac" : ""}/finance?${clean}`;
}
export function financeWorkbenchKey(
  query: FinanceWorkbenchQuery,
  mode: FinanceWorkbenchMode,
): string {
  return JSON.stringify([
    mode,
    query.kind,
    query.page,
    Object.entries(query.filters).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

export function financeScopeIsValid(
  query: FinanceWorkbenchQuery,
  projects: FinanceProjectOption[],
  buildings: FinanceBuildingOption[],
): boolean {
  const projectId = query.filters.projectId;
  const buildingId = query.filters.buildingId;
  if (projectId && !projects.some((project) => project.id === projectId)) return false;
  if (buildingId) {
    const building = buildings.find((item) => item.id === buildingId);
    if (!building || (projectId && building.project_id !== projectId)) return false;
  }
  return true;
}
export function financeManagedOutstanding(row: FinanceReadResult["rows"][number]): number | null {
  if (row.management_status !== "managed" || row.status === "cancelled") return null;
  return Math.max(0, financeRowMoney(row).amount - financeRowMoney(row, true).amount);
}
export const financeIssueLabels: Record<"zh" | "fr", Record<string, string>> = {
  zh: {
    sale_schedule_unlinked: "出售计划与应收尚未关联（不代表实际欠款）",
    sale_link_mismatch: "出售计划与应收关联不一致",
    sale_component_mismatch: "出售组合计划与多条应收不一致",
    sale_schedule_status_disagreement: "出售计划与应收结清状态不一致",
    allocation_amount_mismatch: "收款分配金额不一致",
    duplicate_payment_ledger: "同一付款关联多笔分录（需核对，不一定重复）",
    cimac_customer_collection_mismatch: "客户总账收款分配或分录不一致",
  },
  fr: {
    sale_schedule_unlinked: "Échéance sans lien avec une créance (ne prouve pas une dette)",
    sale_link_mismatch: "Lien échéance/créance incohérent",
    sale_component_mismatch: "Composantes de l’échéance incohérentes",
    sale_schedule_status_disagreement: "Statuts de règlement incohérents",
    allocation_amount_mismatch: "Montant réparti incohérent",
    duplicate_payment_ledger:
      "Plusieurs écritures pour un paiement (à vérifier, pas forcément un doublon)",
    cimac_customer_collection_mismatch:
      "Répartition ou écritures d’un encaissement client incohérentes",
  },
};
