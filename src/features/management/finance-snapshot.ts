export type FinanceDetailType = "collected" | "outstanding" | "overdue" | "upcoming";

export interface ManagementFinanceSummary {
  /** Legacy aggregate fields retained for snapshot compatibility; dashboard does not use them. */
  totalReceivable: number;
  totalPaid: number;
  monthCollected: number;
  outstanding: number;
  overdue: number;
  upcoming: number;
  count: number;
  historicalPending: number;
  historicalPendingCount: number;
  collectionRate: number;
}

export interface ManagementFinanceItem {
  id: string;
  dueDate: string;
  sourceType: string;
  category: string | null;
  title: string | null;
  amountXof: number;
  paidAmountXof: number;
  outstandingXof: number;
  status: "paid" | "partial" | "pending" | "overdue";
  buildingId: string | null;
  buildingCode: string | null;
  buildingName: string | null;
  unitId: string | null;
  unitNo: string | null;
  customerId: string | null;
  customerName: string | null;
}

export interface ManagementPaymentItem {
  id: string;
  paymentDate: string;
  sourceType: string;
  amountXof: number;
  isRefund: boolean;
  buildingId: string | null;
  buildingCode: string | null;
  buildingName: string | null;
  unitId: string | null;
  unitNo: string | null;
  customerId: string | null;
  customerName: string | null;
  receiptNo: string | null;
}

export interface ManagementFinanceSnapshot {
  monthStart: string;
  monthEndExclusive: string;
  asOf: string;
  summary: ManagementFinanceSummary;
  items: ManagementFinanceItem[];
  paymentItems: ManagementPaymentItem[];
}

type RawSnapshot = {
  month_start?: unknown;
  month_end_exclusive?: unknown;
  as_of?: unknown;
  summary?: Record<string, unknown>;
  items?: Record<string, unknown>[];
};

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asNullableString = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;

export function parseManagementFinanceSnapshot(value: unknown): ManagementFinanceSnapshot {
  const raw = (value && typeof value === "object" ? value : {}) as RawSnapshot;
  const summary = raw.summary ?? {};
  const items = Array.isArray(raw.items) ? raw.items : [];

  return {
    monthStart: String(raw.month_start ?? ""),
    monthEndExclusive: String(raw.month_end_exclusive ?? ""),
    asOf: String(raw.as_of ?? ""),
    summary: {
      totalReceivable: asNumber(summary.total_receivable),
      totalPaid: asNumber(summary.total_paid),
      monthCollected: asNumber(summary.month_collected ?? summary.total_paid),
      outstanding: asNumber(summary.outstanding),
      overdue: asNumber(summary.overdue),
      upcoming: asNumber(summary.upcoming),
      count: asNumber(summary.count),
      historicalPending: asNumber(summary.historical_pending),
      historicalPendingCount: asNumber(summary.historical_pending_count),
      collectionRate: asNumber(summary.collection_rate),
    },
    items: items.map((item) => ({
      id: String(item.id ?? ""),
      dueDate: String(item.due_date ?? ""),
      sourceType: String(item.source_type ?? ""),
      category: asNullableString(item.category),
      title: asNullableString(item.title),
      amountXof: asNumber(item.amount_xof),
      paidAmountXof: asNumber(item.paid_amount_xof),
      outstandingXof: asNumber(item.outstanding_xof),
      status: (["paid", "partial", "pending", "overdue"].includes(String(item.status))
        ? String(item.status)
        : "pending") as ManagementFinanceItem["status"],
      buildingId: asNullableString(item.building_id),
      buildingCode: asNullableString(item.building_code),
      buildingName: asNullableString(item.building_name),
      unitId: asNullableString(item.unit_id),
      unitNo: asNullableString(item.unit_no),
      customerId: asNullableString(item.customer_id),
      customerName: asNullableString(item.customer_name),
    })),
    paymentItems: [],
  };
}
