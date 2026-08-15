import type { PaymentRow, ReceivableRow } from "@/types/database";

// ─────────────────────────────────────────────────────────────────────────────
// 财务口径唯一计算引擎（见 docs/finance-metrics-spec.md）。
// 应收 / 已收 / 未收 / 逾期 / 回款率 只允许由本模块产出。
// 已收 = Σ(receivables.paid_amount_xof)，该值已与付款净额（含负向冲销）对齐。
// ─────────────────────────────────────────────────────────────────────────────

export type MetricScope = "period" | "asOf" | "cumulative";

export interface FinanceMetrics {
  /** 应收：应收取总额（含已收+未收） */
  receivable: number;
  /** 已收：实际收到的净额 */
  collected: number;
  /** 未收：应收 − 已收（≥0） */
  outstanding: number;
  /** 逾期：未收中已过到期日的部分 */
  overdue: number;
  /** 回款率：已收 ÷ 应收（应收为 0 时为 0） */
  collectionRate: number;
  count: number;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 某应收单的未收余额（≥0）。 */
export function receivableOutstanding(receivable: ReceivableRow): number {
  return Math.max(0, Number(receivable.amount_xof) - Number(receivable.paid_amount_xof));
}

/**
 * 唯一逾期定义：未收余额 > 0，且（状态为 overdue 或到期日已过）。
 * 到期日当天不算逾期（「已过到期日」才逾期）。
 */
export function isReceivableOverdue(receivable: ReceivableRow, asOfDate: string = todayIso()): boolean {
  if (receivable.status === "cancelled" || receivable.status === "paid") return false;
  if (receivableOutstanding(receivable) <= 0) return false;
  return receivable.due_date < asOfDate;
}

export function isManagedReceivable(receivable: ReceivableRow): boolean {
  return (receivable.management_status ?? "managed") === "managed";
}

export interface ComputeFinanceMetricsOptions {
  /** period：按 due_date 过滤到指定月份（"YYYY-MM"）。asOf/cumulative：全部非 cancelled。 */
  scope?: MetricScope;
  period?: string;
  asOfDate?: string;
}

export function computeFinanceMetrics(
  receivables: ReceivableRow[],
  options: ComputeFinanceMetricsOptions = {},
): FinanceMetrics {
  const asOfDate = options.asOfDate ?? todayIso();

  let rows = receivables.filter((receivable) => receivable.status !== "cancelled" && isManagedReceivable(receivable));
  if (options.scope === "period" && options.period) {
    rows = rows.filter((receivable) => receivable.due_date.startsWith(options.period!));
  } else if (options.scope === "asOf") {
    rows = rows.filter((receivable) => receivable.due_date <= asOfDate);
  }

  let receivable = 0;
  let collected = 0;
  let overdue = 0;

  for (const row of rows) {
    const amount = Number(row.amount_xof);
    const paid = Number(row.paid_amount_xof);
    receivable += amount;
    collected += paid;
    if (isReceivableOverdue(row, asOfDate)) {
      overdue += receivableOutstanding(row);
    }
  }

  const outstanding = rows.reduce((sum, row) => sum + receivableOutstanding(row), 0);
  const collectionRate = receivable > 0 ? collected / receivable : 0;

  return { receivable, collected, outstanding, overdue, collectionRate, count: rows.length };
}

export function addIsoDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function upcomingReceivables(receivables: ReceivableRow[], asOfDate = todayIso(), days = 15): ReceivableRow[] {
  const end = addIsoDays(asOfDate, days);
  return receivables.filter((row) => row.status !== "cancelled"
    && isManagedReceivable(row)
    && receivableOutstanding(row) > 0
    && row.due_date > asOfDate
    && row.due_date <= end);
}

const REFUND_TYPES = new Set(["lease_deposit_refund", "lease_rent_refund"]);
const EXPENSE_TYPES = new Set(["lease_agency_expense", "lease_other_expense", "sale_agency_expense"]);

export function paymentAmountXof(payment: PaymentRow): number {
  return Number(payment.amount) * (Number(payment.exchange_rate_to_xof) || 1);
}

export function isRefundPayment(payment: PaymentRow): boolean {
  const text = `${payment.notes ?? ""} ${payment.receipt_no ?? ""}`.toLowerCase();
  return REFUND_TYPES.has(payment.source_type)
    || (payment.source_type === "sale_other_expense" && (text.includes("退款") || text.includes("refund") || text.includes("depref")));
}

export function isOperatingExpensePayment(payment: PaymentRow): boolean {
  return !isRefundPayment(payment)
    && (EXPENSE_TYPES.has(payment.source_type) || payment.source_type.endsWith("_expense"));
}

export function netCollectedFromPayments(payments: PaymentRow[]): number {
  return payments.reduce((sum, payment) => {
    const amount = paymentAmountXof(payment);
    if (isRefundPayment(payment)) return sum - amount;
    if (isOperatingExpensePayment(payment)) return sum;
    return sum + amount;
  }, 0);
}
