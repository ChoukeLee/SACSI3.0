import type { ReceivableRow, UnitRow, DailyBookingRow, LeaseContractRow, SaleContractRow, PaymentRow } from "@/types/database";

export interface KpiValue {
  metricKey: string;
  label: string;
  currentValue: number;
  targetValue: number | null;
  unit: string;
  completionRate: number | null; // 0-100
  trend: "up" | "down" | "flat";
}

export interface KpiData {
  totalReceivable: number;
  totalPaid: number;
  totalOutstanding: number;
  totalOverdue: number;
  collectionRate: number;
  occupancyRate: number;
  vacancyRate: number;
  dailyOccupancyRate: number;
  saleRecoveryRate: number;
  expiringLeases30d: number;
  overdueAmount: number;
}

const today = new Date().toISOString().slice(0, 10);
const monthPrefix = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

export function computeKpiData(
  receivables: ReceivableRow[],
  units: UnitRow[],
  dailyBookings: DailyBookingRow[],
  leaseContracts: LeaseContractRow[],
  saleContracts: SaleContractRow[],
): KpiData {
  // Receivables
  let totalRec = 0, totalPaid = 0, totalOverdue = 0;
  for (const r of receivables) {
    if (r.status === "cancelled") continue;
    totalRec += Number(r.amount_xof);
    totalPaid += Number(r.paid_amount_xof);
    const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
    if (os > 0 && (r.status === "overdue" || r.due_date < today)) totalOverdue += os;
  }
  const collectionRate = totalRec > 0 ? Math.round((totalPaid / totalRec) * 100) : 0;
  const outstanding = totalRec - totalPaid;

  // Units
  const residential = units.filter(u => u.kind === "apartment");
  const totalUnits = residential.length;
  const occupied = residential.filter(u =>
    u.status === "leased" || u.status === "daily_occupied" || u.status === "sold"
  ).length;
  const vacant = residential.filter(u => u.status === "available").length;
  const occupancyRate = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;
  const vacancyRate = totalUnits > 0 ? Math.round((vacant / totalUnits) * 100) : 0;

  // Daily
  const checkedIn = dailyBookings.filter(b => b.status === "checked_in").length;
  const dailyOccupancyRate = totalUnits > 0 ? Math.round((checkedIn / totalUnits) * 100) : 0;

  // Sale
  const activeSales = saleContracts.filter(s => s.status === "active");
  let saleTotal = 0, salePaid = 0;
  for (const s of activeSales) saleTotal += Number(s.total_amount_xof);
  const saleRecs = receivables.filter(r => r.source_type === "sale_contract" && r.status !== "cancelled");
  for (const r of saleRecs) salePaid += Number(r.paid_amount_xof);
  const saleRecoveryRate = saleTotal > 0 ? Math.round((salePaid / saleTotal) * 100) : 0;

  // Lease expiring
  const day30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const expiringLeases = leaseContracts.filter(l =>
    l.status === "active" && l.expected_end_date >= today && l.expected_end_date <= day30
  ).length;

  return {
    totalReceivable: totalRec, totalPaid, totalOutstanding: outstanding,
    totalOverdue, collectionRate, occupancyRate, vacancyRate,
    dailyOccupancyRate, saleRecoveryRate, expiringLeases30d: expiringLeases,
    overdueAmount: totalOverdue,
  };
}

export const KPI_DEFINITIONS = [
  { key: "monthly_receivable", labelZh: "月度应收目标", labelFr: "Objectif creances", unit: "XOF", isPercentage: false },
  { key: "monthly_paid", labelZh: "月度实收目标", labelFr: "Objectif encaissements", unit: "XOF", isPercentage: false },
  { key: "collection_rate", labelZh: "收缴率目标", labelFr: "Taux encaissement", unit: "%", isPercentage: true },
  { key: "occupancy_rate", labelZh: "出租率目标", labelFr: "Taux occupation", unit: "%", isPercentage: true },
  { key: "daily_occupancy_rate", labelZh: "日租入住率目标", labelFr: "Taux occupation jour", unit: "%", isPercentage: true },
  { key: "sale_recovery_rate", labelZh: "销售回款率目标", labelFr: "Taux recouvrement vente", unit: "%", isPercentage: true },
  { key: "vacancy_rate_max", labelZh: "空置率上限", labelFr: "Vacance max", unit: "%", isPercentage: true },
  { key: "overdue_amount_max", labelZh: "欠费金额上限", labelFr: "Impayes max", unit: "XOF", isPercentage: false },
];
