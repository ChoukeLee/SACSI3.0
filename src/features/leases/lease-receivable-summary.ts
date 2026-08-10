import type { ReceivableRow } from "@/types/database";

export interface LeaseReceivableSummary {
  outstanding: number;
  overdue: number;
  earliestOutstandingDue: string | null;
  earliestOverdueDue: string | null;
}

export interface LeaseOverdueResolution {
  dueDate: string;
  amount: number;
  source: "receivable" | "contract";
}

export function addOneIsoDay(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function isOverdueReceivable(receivable: ReceivableRow, today: string): boolean {
  return receivable.status === "overdue" || receivable.due_date <= today;
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

/**
 * Resolve the amount currently overdue for an active lease.
 * Open receivables are authoritative when present. When the receivable for the
 * next rent period has not been materialized yet, paid_through_date remains the
 * coverage source of truth and monthly_rent_xof is the exact next amount due.
 */
export function resolveLeaseOverdue(input: {
  receivables: ReceivableRow[];
  today: string;
  paidThroughDate: string | null;
  monthlyRentXof: number;
}): LeaseOverdueResolution | null {
  const summary = summarizeLeaseReceivables(input.receivables, input.today);
  if (summary.overdue > 0 && summary.earliestOverdueDue) {
    return {
      dueDate: summary.earliestOverdueDue,
      amount: summary.overdue,
      source: "receivable",
    };
  }

  if (!input.paidThroughDate) return null;
  const coverageDue = addOneIsoDay(input.paidThroughDate);
  if (coverageDue > input.today) return null;

  return {
    dueDate: coverageDue,
    amount: Math.max(0, input.monthlyRentXof),
    source: "contract",
  };
}
