import { getUnits, getDailyBookings, getLeaseContracts, getSaleContracts, getCleaningTasks, getCustomers, getManagementFinanceSnapshot } from "./management-data";
import { sortUnits } from "@/lib/utils";
import { FinanceSectionClient, ManagementOverviewClient } from "./management-section-clients";
import type { Locale, ManagementDict } from "@/lib/i18n";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, CustomerRow,
} from "@/types/database";

// ────────────────────────────────────────────────────────────
// Finance section (async — fetches receivables + payments)
// ────────────────────────────────────────────────────────────

export async function FinanceSection({
  locale, t,
}: {
  locale: Locale; t: ManagementDict; buildings: BuildingRow[];
}) {
  const snapshot = await getManagementFinanceSnapshot();

  return (
    <FinanceSectionClient
      snapshot={snapshot}
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
    cleaningTasksRaw, customersRaw, snapshot,
  ] = await Promise.all([
    getUnits(), getDailyBookings(), getLeaseContracts(),
    getSaleContracts(), getCleaningTasks(), getCustomers(), getManagementFinanceSnapshot(),
  ]);

  const units = sortUnits((unitsRaw ?? []) as unknown as UnitRow[]);
  const dailyBookings = (dailyBookingsRaw ?? []) as DailyBookingRow[];
  const leaseContracts = (leaseContractsRaw ?? []) as LeaseContractRow[];
  const saleContracts = (saleContractsRaw ?? []) as SaleContractRow[];
  const cleaningTasks = (cleaningTasksRaw ?? []) as { unit_id: string; is_completed: boolean }[];
  const customers = (customersRaw ?? []) as CustomerRow[];

  return (
    <ManagementOverviewClient
      snapshot={snapshot}
      buildings={buildings}
      units={units}
      dailyBookings={dailyBookings}
      leaseContracts={leaseContracts}
      saleContracts={saleContracts}
      cleaningTasks={cleaningTasks}
      customers={customers}
      locale={locale}
      t={t}
    />
  );
}

