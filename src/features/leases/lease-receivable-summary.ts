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
  startedPeriods: number;
}

export function addOneIsoDay(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function isOverdueReceivable(receivable: ReceivableRow, today: string): boolean {
  return receivable.due_date < today;
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addAnchoredUtcMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetDay = Math.min(day, daysInUtcMonth(target.getUTCFullYear(), target.getUTCMonth()));
  target.setUTCDate(targetDay);
  return target.toISOString().slice(0, 10);
}

/**
 * Count every rent period that has started, using the first uncovered day as
 * the monthly anchor. A partly elapsed period counts as a full period.
 */
export function countStartedLeasePeriods(firstUncoveredDate: string, throughDate: string): number {
  if (firstUncoveredDate > throughDate) return 0;

  const [startYear, startMonth] = firstUncoveredDate.split("-").map(Number);
  const [throughYear, throughMonth] = throughDate.split("-").map(Number);
  let monthOffset = (throughYear - startYear) * 12 + (throughMonth - startMonth);
  if (addAnchoredUtcMonths(firstUncoveredDate, monthOffset) > throughDate) monthOffset -= 1;
  return Math.max(0, monthOffset + 1);
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
 * Resolve rent accrued through the selected date. paid_through_date is the
 * coverage source of truth: every monthly period that has started after it is
 * counted in full. Materialized rent receivables and their payments are then
 * reconciled with that accrual so existing rows are never counted twice.
 */
export function resolveLeaseOverdue(input: {
  receivables: ReceivableRow[];
  today: string;
  paidThroughDate: string | null;
  monthlyRentXof: number;
  contractStatus?: string | null;
  actualEndDate?: string | null;
}): LeaseOverdueResolution | null {
  const throughDate = input.contractStatus === "terminated" && input.actualEndDate
    ? [input.today, input.actualEndDate].sort()[0]
    : input.today;
  const rentReceivables = input.receivables.filter((row) => row.category === "lease_rent" && row.status !== "cancelled");

  if (!input.paidThroughDate) {
    const dueRows = rentReceivables.filter((row) => row.due_date <= throughDate);
    const amount = dueRows.reduce((sum, row) => sum + Math.max(0, Number(row.amount_xof) - Number(row.paid_amount_xof)), 0);
    if (amount <= 0) return null;
    return {
      dueDate: dueRows.map((row) => row.due_date).sort()[0],
      amount,
      source: "receivable",
      startedPeriods: 0,
    };
  }

  const coverageDue = addOneIsoDay(input.paidThroughDate);
  const startedPeriods = countStartedLeasePeriods(coverageDue, throughDate);
  const monthlyRent = Math.max(0, Number(input.monthlyRentXof));

  const dueRows = rentReceivables.filter((row) => row.due_date <= throughDate);
  const priorRows = dueRows.filter((row) => row.due_date < coverageDue);
  const coveredRows = dueRows.filter((row) => row.due_date >= coverageDue);
  const priorOutstanding = priorRows.reduce((sum, row) => sum + Math.max(0, Number(row.amount_xof) - Number(row.paid_amount_xof)), 0);
  const coveredOutstanding = coveredRows.reduce((sum, row) => sum + Math.max(0, Number(row.amount_xof) - Number(row.paid_amount_xof)), 0);
  const coveredPaid = coveredRows.reduce((sum, row) => {
    const amount = Math.max(0, Number(row.amount_xof));
    return sum + Math.min(amount, Math.max(0, Number(row.paid_amount_xof)));
  }, 0);
  const accruedOutstanding = Math.max(0, startedPeriods * monthlyRent - coveredPaid);
  const amount = priorOutstanding + Math.max(coveredOutstanding, accruedOutstanding);
  if (amount <= 0) return null;

  const openDueDates = dueRows
    .filter((row) => Number(row.amount_xof) > Number(row.paid_amount_xof))
    .map((row) => row.due_date);
  if (startedPeriods > 0 && accruedOutstanding > 0) openDueDates.push(coverageDue);
  const dueDate = openDueDates.sort()[0] ?? coverageDue;

  return {
    dueDate,
    amount,
    source: accruedOutstanding > coveredOutstanding ? "contract" : "receivable",
    startedPeriods,
  };
}
