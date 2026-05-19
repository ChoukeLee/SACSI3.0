import type { ReceivableRow, BuildingRow, UnitRow, LedgerEntryRow } from "@/types/database";

// ── Types ────────────────────────────────────────────────────────────────

export interface ReceivableSummary {
  totalReceivable: number;
  totalPaid: number;
  outstanding: number;
  overdue: number;
  count: number;
  collectionRate: number; // 0–1
}

export interface ReceivableByBusinessType {
  businessType: string;
  totalReceivable: number;
  totalPaid: number;
  outstanding: number;
  overdue: number;
  count: number;
}

export interface BuildingFinancials {
  buildingId: string | null;
  buildingName: string;
  totalUnits: number;
  totalReceivable: number;
  totalPaid: number;
  outstanding: number;
  overdue: number;
  income: number;
  expense: number;
  net: number;
  collectionRate: number;
}

export interface ReceivableFilters {
  status?: string;
  sourceType?: string;
  buildingId?: string;
  dateFrom?: string;
  dateTo?: string;
  /** If true, only include receivables for the current calendar month. */
  currentMonth?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const todayStr = new Date().toISOString().slice(0, 10);
const currentMonthPrefix = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

function isOverdue(r: ReceivableRow): boolean {
  if (r.status === "cancelled" || r.status === "paid") return false;
  const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof);
  if (outstanding <= 0) return false;
  return r.status === "overdue" || r.due_date < todayStr;
}

function isCurrentMonth(dateStr: string): boolean {
  return dateStr.startsWith(currentMonthPrefix);
}

function applyFilters(receivables: ReceivableRow[], filters?: ReceivableFilters): ReceivableRow[] {
  return receivables.filter((r) => {
    if (r.status === "cancelled") return false;
    if (filters?.status && r.status !== filters.status) return false;
    if (filters?.sourceType && r.source_type !== filters.sourceType) return false;
    if (filters?.buildingId && r.building_id !== filters.buildingId) return false;
    if (filters?.dateFrom && r.due_date < filters.dateFrom) return false;
    if (filters?.dateTo && r.due_date > filters.dateTo) return false;
    if (filters?.currentMonth && !isCurrentMonth(r.due_date)) return false;
    return true;
  });
}

// ── Public functions ─────────────────────────────────────────────────────

export function calculateReceivableSummary(
  receivables: ReceivableRow[],
  filters?: ReceivableFilters,
): ReceivableSummary {
  const filtered = applyFilters(receivables, filters);

  let totalReceivable = 0;
  let totalPaid = 0;
  let overdue = 0;

  for (const r of filtered) {
    totalReceivable += Number(r.amount_xof);
    totalPaid += Number(r.paid_amount_xof);
    if (isOverdue(r)) {
      overdue += Number(r.amount_xof) - Number(r.paid_amount_xof);
    }
  }

  const outstanding = totalReceivable - totalPaid;
  const collectionRate = totalReceivable > 0 ? totalPaid / totalReceivable : 0;

  return {
    totalReceivable,
    totalPaid,
    outstanding,
    overdue,
    count: filtered.length,
    collectionRate,
  };
}

export function calculateReceivableByBusinessType(
  receivables: ReceivableRow[],
  filters?: ReceivableFilters,
): ReceivableByBusinessType[] {
  const filtered = applyFilters(receivables, filters);

  const groups = new Map<string, ReceivableByBusinessType>();

  for (const r of filtered) {
    const key = r.source_type;
    let g = groups.get(key);
    if (!g) {
      g = { businessType: key, totalReceivable: 0, totalPaid: 0, outstanding: 0, overdue: 0, count: 0 };
      groups.set(key, g);
    }
    g.totalReceivable += Number(r.amount_xof);
    g.totalPaid += Number(r.paid_amount_xof);
    g.count++;
    if (isOverdue(r)) {
      g.overdue += Number(r.amount_xof) - Number(r.paid_amount_xof);
    }
  }

  for (const g of groups.values()) {
    g.outstanding = g.totalReceivable - g.totalPaid;
  }

  return [...groups.values()].sort((a, b) => b.totalReceivable - a.totalReceivable);
}

export function calculateReceivableByBuilding(
  receivables: ReceivableRow[],
  buildings: BuildingRow[],
  units: UnitRow[],
  ledgerEntries: LedgerEntryRow[],
  filters?: ReceivableFilters,
): BuildingFinancials[] {
  const filtered = applyFilters(receivables, filters);

  // Build unit → building lookup
  const unitBuildingMap = new Map<string, string>();
  for (const u of units) {
    unitBuildingMap.set(u.id, u.building_id);
  }

  // Build building name map
  const buildingNameMap = new Map<string, string>();
  for (const b of buildings) {
    buildingNameMap.set(b.id, b.display_name || b.code);
  }

  // Count units per building
  const buildingUnitCount = new Map<string, number>();
  for (const u of units) {
    buildingUnitCount.set(u.building_id, (buildingUnitCount.get(u.building_id) ?? 0) + 1);
  }

  // Aggregate ledger entries by building
  const buildingLedger = new Map<string | null, { income: number; expense: number }>();
  for (const e of ledgerEntries) {
    const bid = e.building_id ?? null;
    let l = buildingLedger.get(bid);
    if (!l) {
      l = { income: 0, expense: 0 };
      buildingLedger.set(bid, l);
    }
    if (e.direction === "income") {
      l.income += Number(e.amount_xof);
    } else if (e.direction === "expense") {
      l.expense += Number(e.amount_xof);
    }
  }

  // Aggregate receivables by building
  const buildingStats = new Map<string | null, {
    totalReceivable: number; totalPaid: number; overdue: number;
  }>();

  for (const r of filtered) {
    const bid = r.building_id ?? unitBuildingMap.get(r.unit_id ?? "") ?? null;
    let s = buildingStats.get(bid);
    if (!s) {
      s = { totalReceivable: 0, totalPaid: 0, overdue: 0 };
      buildingStats.set(bid, s);
    }
    s.totalReceivable += Number(r.amount_xof);
    s.totalPaid += Number(r.paid_amount_xof);
    if (isOverdue(r)) {
      s.overdue += Number(r.amount_xof) - Number(r.paid_amount_xof);
    }
  }

  // Collect all building IDs
  const allBids = new Set<string | null>();
  for (const bid of buildingStats.keys()) allBids.add(bid);
  for (const b of buildings) allBids.add(b.id);
  allBids.add(null); // unassigned

  const result: BuildingFinancials[] = [];

  for (const bid of allBids) {
    const s = buildingStats.get(bid);
    const l = buildingLedger.get(bid);
    const totalReceivable = s?.totalReceivable ?? 0;
    const totalPaid = s?.totalPaid ?? 0;
    const outstanding = totalReceivable - totalPaid;
    const income = l?.income ?? 0;
    const expense = l?.expense ?? 0;

    const name = bid ? (buildingNameMap.get(bid) ?? bid) : "unassigned";

    if (totalReceivable === 0 && income === 0 && expense === 0) {
      // Only include if it has some data
      if (bid && (buildingUnitCount.get(bid) ?? 0) > 0) {
        result.push({
          buildingId: bid,
          buildingName: name,
          totalUnits: buildingUnitCount.get(bid) ?? 0,
          totalReceivable: 0,
          totalPaid: 0,
          outstanding: 0,
          overdue: 0,
          income: 0,
          expense: 0,
          net: 0,
          collectionRate: 0,
        });
      }
      continue;
    }

    result.push({
      buildingId: bid,
      buildingName: name,
      totalUnits: bid ? (buildingUnitCount.get(bid) ?? 0) : 0,
      totalReceivable,
      totalPaid,
      outstanding,
      overdue: s?.overdue ?? 0,
      income,
      expense,
      net: income - expense,
      collectionRate: totalReceivable > 0 ? totalPaid / totalReceivable : 0,
    });
  }

  return result.sort((a, b) => b.totalReceivable - a.totalReceivable);
}

export function getOverdueReceivables(
  receivables: ReceivableRow[],
  limit = 10,
): ReceivableRow[] {
  return receivables
    .filter((r) => isOverdue(r))
    .sort((a, b) => {
      const aOut = Number(a.amount_xof) - Number(a.paid_amount_xof);
      const bOut = Number(b.amount_xof) - Number(b.paid_amount_xof);
      return bOut - aOut;
    })
    .slice(0, limit);
}

export function getOutstandingReceivables(
  receivables: ReceivableRow[],
  limit = 10,
): ReceivableRow[] {
  return receivables
    .filter((r) => {
      if (r.status === "cancelled" || r.status === "paid") return false;
      return Number(r.amount_xof) - Number(r.paid_amount_xof) > 0;
    })
    .sort((a, b) => {
      const aOut = Number(a.amount_xof) - Number(a.paid_amount_xof);
      const bOut = Number(b.amount_xof) - Number(b.paid_amount_xof);
      return bOut - aOut;
    })
    .slice(0, limit);
}

export function buildReceivableCsv(
  receivables: ReceivableRow[],
  unitMap: Map<string, string>,
  buildingMap: Map<string, string>,
  customerMap: Map<string, string>,
  labelMap: Record<string, string>,
): string {
  const header = [
    "DueDate", "Building", "Unit", "Customer", "SourceType", "Category",
    "Title", "Amount_XOF", "Paid_XOF", "Outstanding_XOF", "Status", "OverdueDays",
  ].join(",");

  const rows = receivables.map((r) => {
    const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
    const overdueDays = (() => {
      if (r.status === "paid" || r.status === "cancelled") return "";
      if (r.due_date >= todayStr) return "";
      return String(Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000));
    })();

    return [
      r.due_date,
      `"${buildingMap.get(r.building_id ?? "") ?? ""}"`,
      `"${unitMap.get(r.unit_id ?? "") ?? ""}"`,
      `"${(customerMap.get(r.customer_id ?? "") ?? "").replace(/"/g, '""')}"`,
      `"${labelMap[r.source_type] ?? r.source_type}"`,
      `"${labelMap[r.category] ?? r.category}"`,
      `"${(r.title ?? "").replace(/"/g, '""')}"`,
      r.amount_xof,
      r.paid_amount_xof,
      os,
      `"${labelMap[r.status] ?? r.status}"`,
      overdueDays,
    ].join(",");
  });

  return [header, ...rows].join("\n");
}
