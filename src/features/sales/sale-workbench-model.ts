import type {
  SaleContractRow,
  SalePaymentScheduleRow,
  ReceivableRow,
  PaymentRow,
} from "@/types/database";
import type { CurrencyCode } from "@/types/domain";
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
  if ((contract.sale_currency ?? "XOF") !== "XOF") return null;
  const value = Number(contract.total_amount_xof);
  return contract.total_amount_xof !== null &&
    contract.total_amount_confirmed === true &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : null;
}

export interface SaleCurrencyAmount {
  currency: CurrencyCode;
  amount: number;
}

function minorUnits(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
  )
    return null;
  const number = Number(value),
    cents = Math.round(number * 100);
  return Number.isFinite(number) &&
    number >= 0 &&
    Number.isSafeInteger(cents) &&
    Math.abs(cents / 100 - number) < 0.0000001
    ? cents
    : null;
}

/** Registered price is independent of cash receipts and bill allocations. */
export function saleRegisteredPrice(contract: SaleContractRow): SaleCurrencyAmount | null {
  const currency = contract.sale_currency ?? "XOF";
  if (currency === "XOF") {
    const amount = salePrice(contract);
    return amount === null ? null : { currency, amount };
  }
  const amount = minorUnits(contract.total_amount_native);
  return ["USD", "CNY"].includes(currency) &&
    contract.total_amount_confirmed === true &&
    contract.total_amount_xof !== null &&
    Number(contract.total_amount_xof) === 0 &&
    amount !== null &&
    amount > 0
    ? { currency, amount: amount / 100 }
    : null;
}

/** Original-currency gross purchase receipts; an unknown historical method is not an offset. */
export function buildSalePurchaseReceiptSummary(
  contract: SaleContractRow,
  payments: readonly PaymentRow[],
) {
  const totals = new Map<CurrencyCode, number>(),
    receiptIds = new Set<string>(),
    seen = new Set<string>();
  for (const payment of payments) {
    if (
      payment.source_id !== contract.id ||
      !["sale", "sale_contract"].includes(payment.source_type) ||
      seen.has(payment.id)
    )
      continue;
    seen.add(payment.id);
    if (
      payment.payment_method === "offset" ||
      payment.reversal_of_payment_id ||
      payment.request_kind?.includes("reversal")
    )
      continue;
    const amount = minorUnits(payment.amount),
      rate = Number(payment.exchange_rate_to_xof);
    const moneyBasis =
      payment.native_settlement === true
        ? payment.source_type === "sale_contract" &&
          ["USD", "CNY"].includes(payment.currency) &&
          payment.currency === (contract.sale_currency ?? "XOF") &&
          payment.unit_id === contract.unit_id &&
          payment.customer_id === contract.customer_id &&
          payment.exchange_rate_to_xof === null
        : Number.isFinite(rate) && rate > 0 && (payment.currency !== "XOF" || rate === 1);
    const validDate =
      /^\d{4}-\d{2}-\d{2}$/.test(payment.payment_date) &&
      Number.isFinite(Date.parse(payment.payment_date + "T00:00:00Z")) &&
      new Date(payment.payment_date + "T00:00:00Z").toISOString().slice(0, 10) ===
        payment.payment_date;
    if (
      !["XOF", "CNY", "USD"].includes(payment.currency) ||
      !validDate ||
      amount === null ||
      amount <= 0 ||
      !moneyBasis ||
      (payment.payment_method != null &&
        !["cash", "check", "bank_transfer", "other"].includes(String(payment.payment_method))) ||
      (payment.unit_id !== null && payment.unit_id !== contract.unit_id) ||
      (payment.customer_id !== null && payment.customer_id !== contract.customer_id)
    )
      continue;
    totals.set(payment.currency, (totals.get(payment.currency) ?? 0) + amount);
    receiptIds.add(payment.id);
  }
  return {
    amounts: [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => ({ currency, amount: amount / 100 })),
    receiptIds,
  };
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
      label: zh ? "西法登记总额" : "Total enregistré en XOF",
      value: money(stats.total),
      hint: zh
        ? "非现金实收 · 原币未折算部分另列，不与西法相加。"
        : "Pas du cash · devises non converties présentées séparément, sans addition aux XOF.",
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
