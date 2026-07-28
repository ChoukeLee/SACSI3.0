import { getUnits, getDailyBookings, getLeaseContracts, getSaleContracts, getSaleSchedules, getCleaningTasks, getReceivables, getPayments, getCustomers } from "./management-data";
import { runQualityChecks } from "@/features/data-quality";
import { QualityDashboardWidget } from "@/features/data-quality";
import { sortUnits } from "@/lib/utils";
import { FinanceSectionClient, UnitDataClient } from "./management-section-clients";
import type { Locale, ManagementDict } from "@/lib/i18n";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, ReceivableRow, PaymentRow, CustomerRow,
} from "@/types/database";

// ────────────────────────────────────────────────────────────
// Finance section (async — fetches receivables + payments)
// ────────────────────────────────────────────────────────────

export async function FinanceSection({
  locale, t, buildings,
}: {
  locale: Locale; t: ManagementDict; buildings: BuildingRow[];
}) {
  const [receivablesRaw, unitsRaw, customersRaw] = await Promise.all([
    getReceivables(),
    getUnits(),
    getCustomers(),
  ]);
  const receivables = (receivablesRaw ?? []) as ReceivableRow[];
  const units = sortUnits((unitsRaw ?? []) as UnitRow[]);
  const customers = (customersRaw ?? []) as CustomerRow[];

  return (
    <FinanceSectionClient
      receivables={receivables}
      units={units}
      customers={customers}
      buildings={buildings}
      locale={locale}
      t={t}
    />
  );
}

// ────────────────────────────────────────────────────────────
// Unit data section (async — fetches all unit-related data)
// ────────────────────────────────────────────────────────────

export async function UnitDataSection({
  buildings, locale, t,
}: {
  buildings: BuildingRow[]; locale: Locale; t: ManagementDict;
}) {
  const [
    unitsRaw, dailyBookingsRaw, leaseContractsRaw, saleContractsRaw,
    saleSchedulesRaw, cleaningTasksRaw, customersRaw,
  ] = await Promise.all([
    getUnits(), getDailyBookings(), getLeaseContracts(),
    getSaleContracts(), getSaleSchedules(), getCleaningTasks(), getCustomers(),
  ]);

  const units = sortUnits((unitsRaw ?? []) as UnitRow[]);
  const dailyBookings = (dailyBookingsRaw ?? []) as DailyBookingRow[];
  const leaseContracts = (leaseContractsRaw ?? []) as LeaseContractRow[];
  const saleContracts = (saleContractsRaw ?? []) as SaleContractRow[];
  const saleSchedules = (saleSchedulesRaw ?? []) as SalePaymentScheduleRow[];
  const cleaningTasks = (cleaningTasksRaw ?? []) as { unit_id: string; is_completed: boolean }[];
  const customers = (customersRaw ?? []) as CustomerRow[];

  return (
    <UnitDataClient
      buildings={buildings}
      units={units}
      dailyBookings={dailyBookings}
      leaseContracts={leaseContracts}
      saleContracts={saleContracts}
      saleSchedules={saleSchedules}
      cleaningTasks={cleaningTasks}
      customers={customers}
      locale={locale}
      t={t}
    />
  );
}

// ────────────────────────────────────────────────────────────
// Quality section (async)
// ────────────────────────────────────────────────────────────

export async function QualitySection({
  locale, userRole,
}: {
  locale: Locale; userRole: string;
}) {
  const [
    unitsRaw, customersRaw, dailyBookingsRaw, leaseContractsRaw,
    saleContractsRaw, saleSchedulesRaw, receivablesRaw, paymentsRaw,
  ] = await Promise.all([
    getUnits(), getCustomers(), getDailyBookings(), getLeaseContracts(),
    getSaleContracts(), getSaleSchedules(), getReceivables(), getPayments(),
  ]);

  const qualityIssues = runQualityChecks({
    units: (unitsRaw ?? []) as UnitRow[],
    customers: (customersRaw ?? []) as CustomerRow[],
    dailyBookings: (dailyBookingsRaw ?? []) as DailyBookingRow[],
    leaseContracts: (leaseContractsRaw ?? []) as LeaseContractRow[],
    saleContracts: (saleContractsRaw ?? []) as SaleContractRow[],
    saleSchedules: (saleSchedulesRaw ?? []) as SalePaymentScheduleRow[],
    receivables: (receivablesRaw ?? []) as ReceivableRow[],
    payments: (paymentsRaw ?? []) as PaymentRow[],
  }, userRole as "admin" | "boss" | "finance" | "front_desk");

  if (!qualityIssues || qualityIssues.length === 0) return null;
  return <QualityDashboardWidget issues={qualityIssues} locale={locale} variant="management" />;
}
