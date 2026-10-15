export type ContractSortKey = "unit" | "customer" | "period" | "amount" | "balance" | "status";
export type ContractSort = { key: ContractSortKey; direction: "asc" | "desc" };

/** Display-only projection. It never calculates cash receipts from contract totals. */
export interface ContractTableRow {
  id: string;
  contractNo: string;
  building: string;
  unit: string;
  customer: string;
  searchText?: string;
  periodStart: string;
  periodLabel: string;
  periodDetail?: string;
  amountXof: number | null;
  amountDetail?: string;
  balanceXof: number | null;
  balanceDetail?: string;
  balanceOverdue?: boolean;
  status: string;
  statusLabel: string;
  secondaryLabel?: string;
  needsReview?: boolean;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

export function matchesContractSearch(row: ContractTableRow, query: string): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const searchable = normalizeSearch(
    [row.contractNo, row.building, row.unit, row.customer, row.searchText ?? ""].join(" "),
  );
  return words.every((word) => searchable.includes(word));
}

export function sortContractRows(rows: ContractTableRow[], sort: ContractSort): ContractTableRow[] {
  const compareText = (left: string, right: string) =>
    left.localeCompare(right, "zh", { numeric: true, sensitivity: "base" });
  return [...rows].sort((left, right) => {
    let order = 0;
    if (sort.key === "amount" || sort.key === "balance") {
      const a = sort.key === "amount" ? left.amountXof : left.balanceXof;
      const b = sort.key === "amount" ? right.amountXof : right.balanceXof;
      // Unknown amounts are always last, never silently converted to zero.
      if (a === null && b !== null) return 1;
      if (b === null && a !== null) return -1;
      order = (a ?? 0) - (b ?? 0);
    } else if (sort.key === "unit") {
      order = compareText(left.building, right.building) || compareText(left.unit, right.unit);
    } else if (sort.key === "customer") {
      order = compareText(left.customer, right.customer);
    } else if (sort.key === "period") {
      order = compareText(left.periodStart, right.periodStart);
    } else {
      order = compareText(left.statusLabel, right.statusLabel);
    }
    return (sort.direction === "asc" ? order : -order) || compareText(left.id, right.id);
  });
}
import type { ReceivableRow } from "@/types/database";
import { computeFinanceMetrics } from "@/features/finance/metrics";
import { formatXofExact } from "@/lib/financial-amount";

export function formatContractXof(amount: number | string | null | undefined, locale: "zh" | "fr") {
  return formatXofExact(amount, locale);
}

export interface ContractReceivableSummary {
  total: number;
  paid: number;
  outstanding: number;
  overdue: number;
  nextDue: string | null;
  count: number;
}

export const EMPTY_CONTRACT_RECEIVABLE_SUMMARY: ContractReceivableSummary = {
  total: 0,
  paid: 0,
  outstanding: 0,
  overdue: 0,
  nextDue: null,
  count: 0,
};

export function buildContractReceivableSummaries(
  rows: ReceivableRow[],
  sourceType: "lease_contract" | "sale_contract",
  today: string,
): Map<string, ContractReceivableSummary> {
  const grouped = new Map<string, ReceivableRow[]>();
  for (const row of rows) {
    if (
      row.source_type !== sourceType ||
      !row.source_id ||
      row.status === "cancelled" ||
      (row.management_status ?? "managed") !== "managed"
    )
      continue;
    const related = grouped.get(row.source_id) ?? [];
    related.push(row);
    grouped.set(row.source_id, related);
  }
  return new Map(
    [...grouped].map(([id, related]) => {
      const metrics = computeFinanceMetrics(related, { asOfDate: today });
      const nextDue =
        related
          .filter((row) => Number(row.amount_xof) > Number(row.paid_amount_xof))
          .map((row) => row.due_date)
          .sort()[0] ?? null;
      return [
        id,
        {
          total: metrics.receivable,
          paid: metrics.collected,
          outstanding: metrics.outstanding,
          overdue: metrics.overdue,
          nextDue,
          count: metrics.count,
        },
      ];
    }),
  );
}
