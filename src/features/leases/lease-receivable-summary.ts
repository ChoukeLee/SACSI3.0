import type { ReceivableRow } from "@/types/database";

export interface LeaseReceivableSummary {
  outstanding: number;
  overdue: number;
  earliestOutstandingDue: string | null;
  earliestOverdueDue: string | null;
}

export function isOverdueReceivable(receivable: ReceivableRow, today: string): boolean {
  return receivable.status === "overdue" || receivable.due_date < today;
}

export function summarizeLeaseReceivables(
  receivables: ReceivableRow[],
  today: string,
): LeaseReceivableSummary {
  let outstanding = 0;
  let overdue = 0;
  let earliestOutstandingDue: string | null = null;
  let earliestOverdueDue: string | null = null;

  for (const receivable of receivables) {
    if (receivable.status === "cancelled") continue;

    const balance = Math.max(0, Number(receivable.amount_xof) - Number(receivable.paid_amount_xof));
    if (balance <= 0) continue;

    outstanding += balance;
    if (!earliestOutstandingDue || receivable.due_date < earliestOutstandingDue) {
      earliestOutstandingDue = receivable.due_date;
    }

    if (isOverdueReceivable(receivable, today)) {
      overdue += balance;
      if (!earliestOverdueDue || receivable.due_date < earliestOverdueDue) {
        earliestOverdueDue = receivable.due_date;
      }
    }
  }

  return { outstanding, overdue, earliestOutstandingDue, earliestOverdueDue };
}
