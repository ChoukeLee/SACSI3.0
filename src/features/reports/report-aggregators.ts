import type { LedgerEntryRow, BuildingRow, UnitRow } from "@/types/database";

// ─────────────────────────────────────────────────────────────────────────────
// 报表纯聚合函数（见 docs/finance-metrics-spec.md 阶段 3）。
// 只做聚合，不做取数/渲染。所有金额以 XOF 整数计。
// P&L 口径：income = direction='income'，expense = direction='expense'；
// liability_in/liability_out（押金等）不属于收支，不计入 P&L。
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthlyPnl {
  months: string[];
  income: number[];
  expense: number[];
  net: number[];
}

export function aggregatePnlMonthly(entries: LedgerEntryRow[], months: string[]): MonthlyPnl {
  const income = months.map(() => 0);
  const expense = months.map(() => 0);
  for (const e of entries) {
    const idx = months.indexOf(e.entry_date.slice(0, 7));
    if (idx < 0) continue;
    if (e.direction === "income") income[idx] += Number(e.amount_xof);
    else if (e.direction === "expense") expense[idx] += Number(e.amount_xof);
  }
  return { months, income, expense, net: income.map((v, i) => v - expense[i]) };
}

export interface BuildingPnl {
  buildingId: string | null;
  buildingName: string;
  income: number;
  expense: number;
  net: number;
}

export function aggregatePnlByBuilding(
  entries: LedgerEntryRow[],
  buildings: BuildingRow[],
  units: UnitRow[],
): BuildingPnl[] {
  const unitBuilding = new Map(units.map((u) => [u.id, u.building_id]));
  const buildingName = new Map(buildings.map((b) => [b.id, b.display_name || b.code]));
  const map = new Map<string | null, { income: number; expense: number }>();

  for (const e of entries) {
    const bid = e.building_id ?? (e.unit_id ? unitBuilding.get(e.unit_id) ?? null : null);
    const g = map.get(bid) ?? { income: 0, expense: 0 };
    if (e.direction === "income") g.income += Number(e.amount_xof);
    else if (e.direction === "expense") g.expense += Number(e.amount_xof);
    map.set(bid, g);
  }

  return [...map.entries()]
    .map(([bid, g]) => ({
      buildingId: bid,
      buildingName: bid ? buildingName.get(bid) ?? bid : "未分楼栋",
      income: g.income,
      expense: g.expense,
      net: g.income - g.expense,
    }))
    .sort((a, b) => b.income - a.income);
}

export interface CategoryBreakdown {
  label: string;
  value: number;
}

export function aggregateByCategory(entries: LedgerEntryRow[], direction: "income" | "expense"): CategoryBreakdown[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.direction !== direction) continue;
    map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount_xof));
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/** 生成从 endMonth（含）往前 count 个月的 "YYYY-MM" 列表（升序）。 */
export function monthRange(endMonth: string, count: number): string[] {
  const [y, m] = endMonth.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - (count - 1), 1));
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    result.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return result;
}
// ─────────────────────────────────────────────────────────────────────────────
// 日租报表聚合（收款按月 / 入住热力）
// ─────────────────────────────────────────────────────────────────────────────

import type { PaymentRow, DailyBookingRow } from "@/types/database";

/** 日租收款（按付款日分月，含负向冲销），返回与 months 对齐的每月净收款。 */
export function aggregateDailyCollectionsMonthly(payments: PaymentRow[], months: string[]): number[] {
  const sums = months.map(() => 0);
  for (const p of payments) {
    const idx = months.indexOf(p.payment_date.slice(0, 7));
    if (idx >= 0) sums[idx] += Number(p.amount);
  }
  return sums;
}

/** 生成某月（YYYY-MM）的全部日期（YYYY-MM-DD，升序）。 */
export function dayRangeOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const result: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    result.push(y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0"));
  }
  return result;
}

export type DailyCellStatus = "occupied" | "reserved" | "cleaning" | "available";

const STATUS_RANK: Record<DailyCellStatus, number> = { available: 0, cleaning: 1, reserved: 2, occupied: 3 };

function statusForDay(bookings: DailyBookingRow[], day: string): DailyCellStatus {
  let best: DailyCellStatus = "available";
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    if (day < b.check_in) continue;
    const end = b.actual_check_out ?? b.check_out ?? null;
    let status: DailyCellStatus | null = null;
    if (b.status === "checked_out" && b.actual_check_out === day) {
      status = "cleaning";
    } else if (end === null || day < end) {
      if (b.status === "checked_in" || b.status === "checked_out") status = "occupied";
      else if (b.status === "confirmed" || b.status === "pending_review") status = "reserved";
    }
    if (status && STATUS_RANK[status] > STATUS_RANK[best]) best = status;
  }
  return best;
}

/**
 * 生成日租热力单元格：cells[unitId][day] = 状态。
 * 只覆盖传入的 unitIds（日租房源）。
 */
export function buildDailyOccupancy(
  bookings: DailyBookingRow[],
  unitIds: string[],
  days: string[],
): Record<string, Record<string, DailyCellStatus>> {
  const byUnit = new Map<string, DailyBookingRow[]>();
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    const list = byUnit.get(b.unit_id) ?? [];
    list.push(b);
    byUnit.set(b.unit_id, list);
  }
  const cells: Record<string, Record<string, DailyCellStatus>> = {};
  for (const unitId of unitIds) {
    const list = byUnit.get(unitId) ?? [];
    cells[unitId] = {};
    for (const day of days) cells[unitId][day] = statusForDay(list, day);
  }
  return cells;
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export interface MonthlyOccupancy {
  month: string;
  occupiedNights: number;
  sellableNights: number;
  rate: number; // 0..1
}

/**
 * 日租入住率（按月）。
 * 可售晚数 = 当前日租房源数 × 当月天数（统一分母，跨月可比）。
 * 入住晚数 = 非取消订单落在该月内的晚数之和（开放式按实际退房日或月末截断）。
 */
export function aggregateOccupancyMonthly(
  bookings: DailyBookingRow[],
  dailyRoomCount: number,
  months: string[],
): MonthlyOccupancy[] {
  return months.map((month) => {
    const [y, m] = month.split("-").map(Number);
    const mStart = month + "-01";
    const mEnd = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    let occupiedNights = 0;
    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      const start = b.check_in;
      const end = b.actual_check_out ?? b.check_out ?? null;
      const lo = start > mStart ? start : mStart;
      const hi = end === null ? mEnd : end < mEnd ? end : mEnd;
      const nights = daysBetween(lo, hi);
      if (nights > 0) occupiedNights += nights;
    }

    const sellableNights = dailyRoomCount * daysInMonth;
    return {
      month,
      occupiedNights,
      sellableNights,
      rate: sellableNights > 0 ? occupiedNights / sellableNights : 0,
    };
  });
}
