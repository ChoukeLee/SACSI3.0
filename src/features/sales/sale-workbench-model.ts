import type { SaleContractRow, SalePaymentScheduleRow, ReceivableRow } from "@/types/database";
import type { WorkspaceQuery, WorkspaceStats } from "@/features/contracts/workspace-model";
import { formatContractXof } from "@/features/contracts/contract-list-model";

export const SALE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function saleWorkbenchHref(query: WorkspaceQuery, contractId?: string | null) {
  const params = new URLSearchParams();
  if (query.projectId) params.set("project", query.projectId);
  if (query.buildingId) params.set("building", query.buildingId);
  if (query.search) params.set("q", query.search);
  if (query.status !== "current") params.set("status", query.status);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.sort !== "unit") params.set("sort", query.sort);
  if (query.direction !== "asc") params.set("direction", query.direction);
  if (contractId && SALE_UUID.test(contractId)) params.set("contract", contractId);
  return `${query.locale === "fr" ? "/fr" : ""}/sales${params.size ? `?${params}` : ""}`;
}

export function salePrice(contract: SaleContractRow) {
  const value = Number(contract.total_amount_xof);
  return contract.total_amount_xof !== null &&
    contract.total_amount_confirmed === true &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : null;
}

export function saleWorkbenchStats(
  stats: Pick<
    WorkspaceStats,
    "active" | "total" | "unknownAll" | "dueOutstanding" | "transferDone"
  >,
  locale: "zh" | "fr",
) {
  const zh = locale === "zh",
    money = (amount: number) => formatContractXof(amount, locale);
  return [
    {
      key: "active" as const,
      label: zh ? "生效出售" : "Ventes actives",
      value: String(stats.active),
      hint: zh ? "当前范围内生效合同" : "Contrats actifs du périmètre",
    },
    {
      key: "total" as const,
      label: zh ? "已录生效合同总额" : "Total actif enregistré",
      value: money(stats.total),
      hint: zh ? "非现金实收 · 合同资料另行核对" : "Pas du cash · prix à vérifier au contrat",
    },
    {
      key: "due" as const,
      label: zh ? "到期未收" : "Dû impayé",
      value: stats.unknownAll ? "—" : money(stats.dueOutstanding),
      hint: zh ? "截至今日 · 仅已核应收" : "À ce jour · créances vérifiées",
    },
    {
      key: "transfer" as const,
      label: zh ? "已过户" : "Transferts terminés",
      value: String(stats.transferDone),
      hint: zh ? "过户不代表已付清" : "Transfert ≠ règlement intégral",
    },
  ];
}

/** Only an explicit link or one unambiguous legacy match can represent a schedule. */
export function saleScheduleReceivable(schedule: SalePaymentScheduleRow, rows: ReceivableRow[]) {
  const eligible = rows.filter(
    (row) =>
      row.source_type === "sale_contract" &&
      row.source_id === schedule.sale_contract_id &&
      row.status !== "cancelled" &&
      (row.management_status ?? "managed") === "managed",
  );
  if (schedule.receivable_id)
    return eligible.find((row) => row.id === schedule.receivable_id) ?? null;
  const matches = eligible.filter(
    (row) =>
      row.due_date === schedule.due_date && Number(row.amount_xof) === Number(schedule.amount_xof),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function saleScheduleState(
  schedule: SalePaymentScheduleRow,
  rows: ReceivableRow[],
  today: string,
) {
  if (schedule.status === "cancelled") return "cancelled";
  const rec = saleScheduleReceivable(schedule, rows);
  if (!rec) return "unverified";
  const amount = Number(rec.amount_xof),
    paid = Number(rec.paid_amount_xof);
  if (!Number.isFinite(amount) || !Number.isFinite(paid) || amount < 0 || paid < 0 || paid > amount)
    return "unverified";
  if (amount === paid) return "paid";
  if (rec.due_date < today) return "overdue";
  return paid > 0 ? "partial" : "pending";
}
