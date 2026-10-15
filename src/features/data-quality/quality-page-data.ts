import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { sortUnits } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import type {
  UnitRow,
  CustomerRow,
  DailyBookingRow,
  LeaseContractRow,
  SaleContractRow,
  SalePaymentScheduleRow,
  ReceivableRow,
  PaymentRow,
} from "@/types/database";
import { runQualityChecks } from "./quality-service";
import { scanDailyRentalIssues } from "@/features/daily-rentals/daily-rental-audit";
import { fetchDatabaseQualityIssues, mergeDatabaseQualityIssues } from "./database-quality-service";
import type { QualityIssue, TodoRole } from "./quality-types";

export type QualityPageResult =
  { status: "complete"; issues: QualityIssue[]; checkedAt: string } | { status: "unavailable" };

/** A failed source invalidates the scan; it must never look like zero findings. */
export async function loadQualityPage(locale: Locale, role: TodoRole): Promise<QualityPageResult> {
  try {
    return {
      status: "complete",
      issues: await fetchQualityIssues(locale, role),
      checkedAt: new Date().toISOString(),
    };
  } catch {
    console.error("QualitySnapshotUnavailable");
    return { status: "unavailable" };
  }
}

async function fetchQualityIssues(locale: Locale, role: TodoRole): Promise<QualityIssue[]> {
  const supabase = await createClient();
  const [
    units,
    customers,
    dailyBookings,
    leaseContracts,
    saleContracts,
    saleSchedules,
    receivables,
    payments,
    cleaningTasks,
    ledgerEntries,
    auditLogs,
    databaseIssues,
  ] = await Promise.all([
    fetchAllPages<UnitRow>(
      (from, to) =>
        supabase
          .from("units")
          .select("*", { count: "exact" })
          .order("unit_no")
          .order("id")
          .range(from, to),
      "quality units",
    ),
    fetchAllPages<CustomerRow>(
      (from, to) =>
        supabase
          .from("customers")
          .select("*", { count: "exact" })
          .order("name")
          .order("id")
          .range(from, to),
      "quality customers",
    ),
    fetchAllPages<DailyBookingRow>(
      (from, to) =>
        supabase
          .from("daily_bookings")
          .select("*", { count: "exact" })
          .order("check_in", { ascending: false })
          .order("id")
          .range(from, to),
      "quality bookings",
    ),
    fetchAllPages<LeaseContractRow>(
      (from, to) =>
        supabase
          .from("lease_contracts")
          .select("*", { count: "exact" })
          .order("start_date", { ascending: false })
          .order("id")
          .range(from, to),
      "quality leases",
    ),
    fetchAllPages<SaleContractRow>(
      (from, to) =>
        supabase
          .from("sale_contracts")
          .select("*", { count: "exact" })
          .order("signed_date", { ascending: false })
          .order("id")
          .range(from, to),
      "quality sales",
    ),
    fetchAllPages<SalePaymentScheduleRow>(
      (from, to) =>
        supabase
          .from("sale_payment_schedule")
          .select("*", { count: "exact" })
          .order("installment_no")
          .order("id")
          .range(from, to),
      "quality sale schedules",
    ),
    fetchAllPages<ReceivableRow>(
      (from, to) =>
        supabase
          .from("receivables")
          .select("*", { count: "exact" })
          .neq("status", "cancelled")
          .order("due_date", { ascending: false })
          .order("id")
          .range(from, to),
      "quality receivables",
    ),
    fetchAllPages<PaymentRow>(
      (from, to) =>
        supabase
          .from("payments")
          .select("*", { count: "exact" })
          .order("payment_date", { ascending: false })
          .order("id")
          .range(from, to),
      "quality payments",
    ),
    fetchAllPages<Record<string, unknown>>(
      (from, to) =>
        supabase.from("cleaning_tasks").select("*", { count: "exact" }).order("id").range(from, to),
      "quality cleaning",
    ),
    fetchAllPages<Record<string, unknown>>(
      (from, to) =>
        supabase
          .from("ledger_entries")
          .select("*", { count: "exact" })
          .order("entry_date", { ascending: false })
          .order("id")
          .range(from, to),
      "quality ledger",
    ),
    fetchAllPages<Record<string, unknown>>(
      (from, to) =>
        supabase
          .from("audit_logs")
          .select("*", { count: "exact" })
          .in("entity_type", ["daily_booking", "unit"])
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      "quality audit",
    ),
    fetchDatabaseQualityIssues(locale),
  ]);
  const existingIssues = runQualityChecks(
    {
      units: sortUnits(units),
      customers,
      dailyBookings,
      leaseContracts,
      saleContracts,
      saleSchedules,
      receivables,
      payments,
    },
    role,
  );
  const dailyIssues = scanDailyRentalIssues({
    dailyBookings: dailyBookings as unknown as Record<string, unknown>[],
    units: units as unknown as Record<string, unknown>[],
    payments: payments as unknown as Record<string, unknown>[],
    receivables: receivables as unknown as Record<string, unknown>[],
    cleaningTasks,
    ledgerEntries,
    auditLogs,
  });
  return mergeDatabaseQualityIssues([...existingIssues, ...dailyIssues], databaseIssues);
}
