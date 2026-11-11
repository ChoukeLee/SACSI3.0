import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getFinanceActualCash } from "@/features/finance/finance-actual-cash-server";
import { loadUnifiedLeaseCollections } from "@/features/leases/unified-lease-collections-page";
import type { Locale } from "@/lib/i18n";
import type { RentalHomeData } from "./rental-first-dashboard";

export function rentalHomeMonth(value: unknown, today: string) {
  return typeof value === "string" &&
    /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value) &&
    value <= today.slice(0, 7)
    ? value
    : today.slice(0, 7);
}

export async function loadRentalHomeData({
  projectId,
  viewerId,
  locale,
  today,
  requestedMonth,
}: {
  projectId: string;
  viewerId: string;
  locale: Locale;
  today: string;
  requestedMonth?: string;
}): Promise<RentalHomeData> {
  const month = rentalHomeMonth(requestedMonth, today);
  const dateFrom = `${month}-01`;
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0))
    .toISOString()
    .slice(0, 10);
  const dateTo = monthEnd > today ? today : monthEnd;
  const [collections, cash] = await Promise.allSettled([
    loadUnifiedLeaseCollections({ locale, project: projectId, viewerId }),
    getFinanceActualCash({ projectId, dateFrom, dateTo }),
  ]);
  for (const result of [collections, cash]) {
    if (result.status === "rejected") unstable_rethrow(result.reason);
  }
  const actual = cash.status === "fulfilled" ? cash.value : null;
  return {
    month,
    rows: collections.status === "fulfilled" ? collections.value.rows : [],
    unavailable:
      collections.status === "fulfilled"
        ? collections.value.unavailable
        : { apartments: true, operatingAssets: true },
    cash: actual
      ? {
          rentIncomeXof: actual.rentIncomeXof,
          expenseXof: actual.expenseXof,
          unknownBookedCount: actual.unknownBookedCount,
          unverifiedLedgerCount: actual.unverifiedLedgerCount,
          costCoverageComplete: actual.costCoverageComplete,
          rentCount: actual.rentReceiptCount,
          expenseCount: actual.expenseReceiptCount,
          originals: actual.nativeTotals.map((row) => ({
            currency: row.currency,
            income: row.incoming,
            expense: row.outgoing,
          })),
        }
      : null,
  };
}
