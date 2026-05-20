"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Download } from "lucide-react";
import {
  calculateReceivableSummary,
  calculateReceivableByBusinessType,
  calculateReceivableByBuilding,
  getOverdueReceivables,
  getOutstandingReceivables,
} from "@/features/finance/receivable-summary";
import { QualityDashboardWidget } from "@/features/data-quality";
import type { QualityIssue } from "@/features/data-quality/quality-types";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { formatXof, cn, sortUnits } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, LedgerEntryRow, ReceivableRow,
} from "@/types/database";

// ── Types ──────────────────────────────────────────────────────────────

export type MgmtStatus =
  | "sold"
  | "leased"
  | "dailyOccupied"
  | "reserved"
  | "cleaningPending"
  | "maintenance"
  | "available";

interface UnitState {
  unit: UnitRow;
  status: MgmtStatus;
}

interface FloorGroup {
  key: string;
  label: string;
  sortValue: number;
  states: UnitState[];
}

interface Props {
  buildings: BuildingRow[];
  units: UnitRow[];
  dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  saleSchedules: SalePaymentScheduleRow[];
  cleaningTasks: { unit_id: string; is_completed: boolean }[];
  ledgerEntries: LedgerEntryRow[];
  receivables: ReceivableRow[];
  qualityIssues?: QualityIssue[];
  locale: Locale;
}

// ── Status colour map — light tint + coloured border + dark label ──────
// bg: room cell (light background, coloured left border, ink text)
// dot: legend swatch (solid square)
// pill: status-count badge in summary row

const STATUS_CELL: Record<MgmtStatus, { bg: string; dot: string; pill: string }> = {
  sold: {
    bg: "bg-stone-100 text-stone-700 border-l-stone-400",
    dot: "bg-stone-500",
    pill: "bg-stone-100 text-stone-700 border-stone-300",
  },
  leased: {
    bg: "bg-blue-50 text-blue-700 border-l-blue-400",
    dot: "bg-blue-500",
    pill: "bg-blue-50 text-blue-700 border-blue-200",
  },
  dailyOccupied: {
    bg: "bg-brand-orange-50 text-brand-orange-700 border-l-brand-orange-400",
    dot: "bg-brand-orange-500",
    pill: "bg-brand-orange-50 text-brand-orange-700 border-brand-orange-200",
  },
  reserved: {
    bg: "bg-amber-50 text-amber-700 border-l-amber-400",
    dot: "bg-amber-500",
    pill: "bg-amber-50 text-amber-700 border-amber-200",
  },
  cleaningPending: {
    bg: "bg-cyan-50 text-cyan-700 border-l-cyan-400",
    dot: "bg-cyan-500",
    pill: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  maintenance: {
    bg: "bg-rose-50 text-rose-700 border-l-rose-400",
    dot: "bg-rose-500",
    pill: "bg-rose-50 text-rose-700 border-rose-200",
  },
  available: {
    bg: "bg-emerald-50 text-emerald-700 border-l-emerald-400",
    dot: "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
};

function firstNumber(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function getUnitFloorValue(unit: UnitRow): number | null {
  const floorFromLabel = firstNumber(unit.floor_label);
  if (floorFromLabel !== null) return floorFromLabel;

  const unitNo = firstNumber(unit.unit_no);
  if (unitNo === null) return null;
  if (unitNo >= 100) return Math.floor(unitNo / 100);
  return unitNo;
}

function groupStatesByFloor(states: UnitState[], locale: Locale): FloorGroup[] {
  const groups = new Map<string, FloorGroup>();

  for (const state of states) {
    const floor = getUnitFloorValue(state.unit);
    const key = floor === null ? "__unknown__" : String(floor);
    const label = floor === null
      ? (locale === "zh" ? "未分层" : "Sans étage")
      : (locale === "zh" ? `${floor}层` : `Étage ${floor}`);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label,
        sortValue: floor ?? Number.MAX_SAFE_INTEGER,
        states: [],
      });
    }

    groups.get(key)!.states.push(state);
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      states: sortUnits(group.states.map(s => s.unit))
        .map(unit => group.states.find(s => s.unit.id === unit.id)!)
        .filter(Boolean),
    }))
    .sort((a, b) => a.sortValue - b.sortValue);
}

// ── Compute unit snapshot status ───────────────────────────────────────

function computeUnitState(
  unit: UnitRow,
  dailyBookings: DailyBookingRow[],
  leaseContracts: LeaseContractRow[],
  saleContracts: SaleContractRow[],
  cleaningTasks: { unit_id: string; is_completed: boolean }[],
): UnitState {
  // 1. Sold
  const hasActiveSale = saleContracts.some(
    s => s.unit_id === unit.id && s.status === "active",
  );
  if (unit.status === "sold" || hasActiveSale) {
    return { unit, status: "sold" };
  }

  // 2. Leased
  const hasActiveLease = leaseContracts.some(
    l => l.unit_id === unit.id && l.status === "active",
  );
  if (unit.status === "leased" || hasActiveLease) {
    return { unit, status: "leased" };
  }

  // 3. Daily occupied
  const hasCheckedIn = dailyBookings.some(
    b => b.unit_id === unit.id && b.status === "checked_in",
  );
  if (unit.status === "daily_occupied" || hasCheckedIn) {
    return { unit, status: "dailyOccupied" };
  }

  // 4. Reserved (pending_review / confirmed)
  const hasReservedBooking = dailyBookings.some(
    b => b.unit_id === unit.id && (b.status === "pending_review" || b.status === "confirmed"),
  );
  if (unit.status === "reserved" || hasReservedBooking) {
    return { unit, status: "reserved" };
  }

  // 5. Cleaning pending
  const hasPendingCleaning = cleaningTasks.some(
    t => t.unit_id === unit.id && !t.is_completed,
  );
  if (unit.status === "cleaning_pending" || hasPendingCleaning) {
    return { unit, status: "cleaningPending" };
  }

  // 6. Maintenance / locked
  if (unit.status === "maintenance" || unit.status === "locked") {
    return { unit, status: "maintenance" };
  }

  // 7. Available
  return { unit, status: "available" };
}

// ── Component ──────────────────────────────────────────────────────────

export function ManagementDashboard({
  buildings, units, dailyBookings, leaseContracts, saleContracts,
  saleSchedules, cleaningTasks, ledgerEntries, receivables, qualityIssues, locale,
}: Props) {
  const t = dictionaries[locale].management;
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>("__all__");

  // Room matrix & status counts only include apartments (exclude parking/storefront/office)
  const residentialUnits = useMemo(
    () => units.filter(u => u.kind === "apartment"),
    [units],
  );

  const activeBuildings = useMemo(
    () => buildings.filter(b => b.is_active),
    [buildings],
  );

  // Filter by building (apartments only)
  const filteredUnits = useMemo(() => {
    if (selectedBuildingId === "__all__") return residentialUnits;
    return residentialUnits.filter(u => u.building_id === selectedBuildingId);
  }, [residentialUnits, selectedBuildingId]);

  const buildingUnits = useMemo(() => {
    const map = new Map<string, UnitRow[]>();
    for (const b of activeBuildings) {
      map.set(b.id, residentialUnits.filter(u => u.building_id === b.id));
    }
    return map;
  }, [activeBuildings, residentialUnits]);

  // Compute unit states
  const unitStates = useMemo(
    () => filteredUnits.map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks)),
    [filteredUnits, dailyBookings, leaseContracts, saleContracts, cleaningTasks],
  );

  // Status counts
  const counts = useMemo(() => {
    const c: Record<MgmtStatus, number> = {
      sold: 0, leased: 0, dailyOccupied: 0, reserved: 0,
      cleaningPending: 0, maintenance: 0, available: 0,
    };
    for (const s of unitStates) c[s.status]++;
    return c;
  }, [unitStates]);

  // Finance: current month
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const finance = useMemo(() => {
    const monthEntries = ledgerEntries.filter(e => e.entry_date.startsWith(monthPrefix));
    const income = monthEntries
      .filter(e => e.direction === "income")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    const expense = monthEntries
      .filter(e => e.direction === "expense")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    const dailyRental = monthEntries
      .filter(e => e.direction === "income" && e.category === "daily_rental")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    const leaseRent = monthEntries
      .filter(e => e.direction === "income" && e.category === "lease_rent")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    const sale = monthEntries
      .filter(e => e.direction === "income" && e.category === "sale")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    const deposit = monthEntries
      .filter(e => e.direction === "liability_in")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    return { income, expense, net: income - expense, dailyRental, leaseRent, sale, deposit };
  }, [ledgerEntries]);

  // Receivables: all-time summary
  const receivableStats = useMemo(
    () => calculateReceivableSummary(receivables),
    [receivables],
  );

  // Receivables: current month summary
  const receivableMonthStats = useMemo(
    () => calculateReceivableSummary(receivables, { currentMonth: true }),
    [receivables],
  );

  // Receivables: by business type (current month)
  const receivableByBiz = useMemo(
    () => calculateReceivableByBusinessType(receivables, { currentMonth: true }),
    [receivables],
  );

  // Receivables: by building (all-time for receivable, all ledger data for income/expense)
  const receivableByBldg = useMemo(
    () => calculateReceivableByBuilding(receivables, activeBuildings, residentialUnits, ledgerEntries),
    [receivables, activeBuildings, residentialUnits, ledgerEntries],
  );

  // Risk leaderboards
  const overdueTop10 = useMemo(
    () => getOverdueReceivables(receivables, 10),
    [receivables],
  );
  const outstandingTop10 = useMemo(
    () => getOutstandingReceivables(receivables, 10),
    [receivables],
  );

  // Unit/building/customer lookups
  const unitMap = useMemo(() => {
    const m = new Map<string, UnitRow>();
    for (const u of units) m.set(u.id, u);
    return m;
  }, [units]);

  const buildingNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of buildings) m.set(b.id, b.display_name || b.code);
    return m;
  }, [buildings]);

  // Risks
  const risks = useMemo(() => {
    const cleaning = unitStates.filter(s => s.status === "cleaningPending").length;
    const maintenance = unitStates.filter(s => s.status === "maintenance").length;

    // Leases expiring within 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    const leaseExpiring = leaseContracts.filter(
      l => l.status === "active" && l.expected_end_date >= todayStr && l.expected_end_date <= cutoffStr,
    );

    // Active sale contracts with incomplete payment schedules
    const activeSales = saleContracts.filter(s => s.status === "active");
    const saleWithPending = activeSales.filter(s =>
      saleSchedules.some(
        sch => sch.sale_contract_id === s.id && sch.status !== "paid",
      ),
    );

    return { cleaning, maintenance, leaseExpiring, saleWithPending };
  }, [unitStates, leaseContracts, saleContracts, saleSchedules]);

  const buildingName = selectedBuildingId === "__all__"
    ? t.allBuildings
    : activeBuildings.find(b => b.id === selectedBuildingId)?.display_name ?? "";

  return (
    <div>
      <PageHeader title={t.title} description={t.description} />

      {/* Building selector */}
      <div className="mb-6 flex flex-wrap gap-2">
        <BuildingTab
          active={selectedBuildingId === "__all__"}
          onClick={() => setSelectedBuildingId("__all__")}
          label={t.allBuildings}
        />
        {activeBuildings.map(b => (
          <BuildingTab
            key={b.id}
            active={selectedBuildingId === b.id}
            onClick={() => setSelectedBuildingId(b.id)}
            label={b.display_name}
          />
        ))}
      </div>

      {/* Section 1: Status summary + legend */}
      <SectionTitle>{t.sections.buildingStatus} — {buildingName}</SectionTitle>
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {(Object.keys(counts) as MgmtStatus[]).map(s => (
          <div key={s} className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
            STATUS_CELL[s].pill,
          )}>
            <span className="tabular-nums font-bold">{counts[s]}</span>
            <span className="opacity-80">{t.statuses[s]}</span>
          </div>
        ))}
      </div>

      {/* Section 2: Room matrix */}
      <div className="mb-8 space-y-6">
        {(selectedBuildingId === "__all__" ? activeBuildings : activeBuildings.filter(b => b.id === selectedBuildingId)).map(building => {
          const bUnits = buildingUnits.get(building.id) ?? [];
          const bStates = sortUnits(bUnits).map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks));
          const floorGroups = groupStatesByFloor(bStates, locale);

          // Per-building counts
          const bCounts: Record<string, number> = {};
          for (const s of bStates) bCounts[s.status] = (bCounts[s.status] ?? 0) + 1;

          return (
            <div key={building.id} className="rounded-xl border border-brand-warm-300 bg-white shadow-card overflow-hidden">
              {/* Building header: name + counts + legend */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-brand-warm-100 bg-brand-warm-50/60">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-orange" />
                  <h4 className="text-[13px] font-bold text-brand-ink-800">{building.display_name}</h4>
                  <span className="rounded-full bg-white border border-brand-warm-200 px-2 py-0 text-[10px] font-semibold text-brand-ink-400">
                    {bStates.length} {locale === "zh" ? "间" : "unités"}
                  </span>
                </div>
                {/* Inline legend — visible at the same time as room cells */}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                  {(Object.keys(t.statuses) as MgmtStatus[]).filter(s => (bCounts[s] ?? 0) > 0).map(s => (
                    <span key={s} className="flex items-center gap-1.5 text-brand-ink-500">
                      <span className={cn("h-2 w-2 rounded-sm", STATUS_CELL[s].dot)} />
                      {t.statuses[s]}
                      <span className="tabular-nums text-brand-ink-300">{(bCounts[s] ?? 0)}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Room cells — floors in compact responsive grid */}
              <div className="px-4 py-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {floorGroups.map(group => (
                    <div key={group.key} className="rounded-lg border border-brand-warm-200 bg-brand-warm-50/30 p-2.5">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-ink-300">
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.states.map(s => {
                          const st = STATUS_CELL[s.status];
                          return (
                            <Link
                              key={s.unit.id}
                              href={routeFor(locale, `/units/${s.unit.id}`)}
                              className={cn(
                                "flex h-9 w-9 items-center justify-center rounded-r-md rounded-l-md",
                                "border border-brand-warm-200 border-l-[3px]",
                                "font-mono text-[11px] font-bold leading-none",
                                "shadow-sm transition-all duration-150",
                                "hover:-translate-y-0.5 hover:shadow-md active:scale-95",
                                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
                                st.bg,
                              )}
                              title={`${s.unit.unit_no} — ${t.statuses[s.status]}`}
                              aria-label={`${s.unit.unit_no} — ${t.statuses[s.status]}`}
                            >
                              {s.unit.unit_no}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Section 3: Finance KPI cards — current month */}
      <SectionTitle>{t.sections.financeOverview}</SectionTitle>
      <div className="mb-8 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-7">
        <MiniStat2 label={t.cockpit.receivableThisMonth} value={formatXof(receivableMonthStats.totalReceivable)} accent="ink" />
        <MiniStat2 label={t.cockpit.paidThisMonth} value={formatXof(receivableMonthStats.totalPaid)} accent="green" />
        <MiniStat2 label={t.cockpit.outstandingThisMonth} value={formatXof(receivableMonthStats.outstanding)} accent="orange" />
        <MiniStat2 label={t.cockpit.overdueThisMonth} value={formatXof(receivableMonthStats.overdue)} accent="red" />
        <MiniStat2 label={t.cockpit.incomeThisMonth} value={formatXof(finance.income)} accent="green" />
        <MiniStat2 label={t.cockpit.expenseThisMonth} value={formatXof(finance.expense)} accent="orange" />
        <MiniStat2 label={t.cockpit.netThisMonth} value={formatXof(finance.net)} accent="ink" />
      </div>

      {/* Section 3.5: By business type breakdown */}
      {receivableByBiz.length > 0 && (
        <>
          <SectionTitle>{t.sections.receivableByBusiness}</SectionTitle>
          <div className="mb-8 overflow-x-auto rounded-xl border border-brand-warm-400 bg-white">
            <table className="w-full min-w-[400px] text-left text-xs">
              <thead className="bg-brand-warm-50 text-[10px] font-semibold uppercase text-brand-ink-400">
                <tr>
                  <th className="px-3 py-2">{locale === "zh" ? "业务类型" : "Type"}</th>
                  <th className="px-3 py-2 text-right">{t.cockpit.receivable}</th>
                  <th className="px-3 py-2 text-right">{t.cockpit.paid}</th>
                  <th className="px-3 py-2 text-right">{t.cockpit.outstanding}</th>
                  <th className="px-3 py-2 text-right">{t.cockpit.overdue}</th>
                  <th className="px-3 py-2 text-right">{t.cockpit.collectionRate}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-warm-400">
                {receivableByBiz.map(biz => {
                  const rate = biz.totalReceivable > 0 ? (biz.totalPaid / biz.totalReceivable * 100) : 0;
                  const bizLabels: Record<string, string> = {
                    daily_booking: t.cockpit.dailyRental,
                    lease_contract: t.cockpit.leaseRental,
                    sale_contract: t.cockpit.sale,
                    manual: t.cockpit.other,
                  };
                  return (
                    <tr key={biz.businessType} className="transition-colors hover:bg-brand-warm-50">
                      <td className="px-3 py-2 font-medium text-brand-ink-700">{bizLabels[biz.businessType] ?? biz.businessType}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-brand-ink-600">{formatXof(biz.totalReceivable)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-brand-green-600">{formatXof(biz.totalPaid)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums font-medium", biz.outstanding > 0 ? "text-brand-red-600" : "text-brand-green-600")}>{formatXof(biz.outstanding)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", biz.overdue > 0 ? "text-brand-red-600 font-medium" : "text-brand-ink-300")}>{formatXof(biz.overdue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-brand-ink-500">{rate.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Section 4: By building breakdown */}
      <SectionTitle>{t.sections.receivableByBuilding}</SectionTitle>
      <div className="mb-8 overflow-x-auto rounded-xl border border-brand-warm-400 bg-white">
        <table className="w-full min-w-[800px] text-left text-xs">
          <thead className="bg-brand-warm-50 text-[10px] font-semibold uppercase text-brand-ink-400">
            <tr>
              <th className="px-3 py-2">{t.cockpit.building}</th>
              <th className="px-3 py-2 text-right">{t.cockpit.totalUnits}</th>
              <th className="px-3 py-2 text-right">{t.cockpit.receivable}</th>
              <th className="px-3 py-2 text-right">{t.cockpit.paid}</th>
              <th className="px-3 py-2 text-right">{t.cockpit.outstanding}</th>
              <th className="px-3 py-2 text-right">{t.cockpit.overdue}</th>
              <th className="px-3 py-2 text-right">{t.cockpit.income}</th>
              <th className="px-3 py-2 text-right">{t.cockpit.expense}</th>
              <th className="px-3 py-2 text-right">{t.cockpit.net}</th>
              <th className="px-3 py-2 text-right">{t.cockpit.collectionRate}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-warm-400">
            {receivableByBldg.map(b => (
              <tr key={b.buildingId ?? "__unassigned__"} className="transition-colors hover:bg-brand-warm-50">
                <td className="px-3 py-2 font-medium text-brand-ink-700">{b.buildingName === "unassigned" ? t.cockpit.unassigned : b.buildingName}</td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-ink-500">{b.totalUnits || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-ink-600">{formatXof(b.totalReceivable)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-green-600">{formatXof(b.totalPaid)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums font-medium", b.outstanding > 0 ? "text-brand-red-600" : "text-brand-green-600")}>{formatXof(b.outstanding)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", b.overdue > 0 ? "text-brand-red-600 font-medium" : "text-brand-ink-300")}>{formatXof(b.overdue)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-green-600">{formatXof(b.income)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-red-500">{formatXof(b.expense)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums font-medium", b.net >= 0 ? "text-brand-green-700" : "text-brand-red-700")}>{formatXof(b.net)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-ink-500">{(b.collectionRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Section 5: Risk leaderboards */}
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>{t.sections.overdueRanking}</SectionTitle>
          {overdueTop10.length === 0 ? (
            <p className="text-xs text-brand-ink-300">{t.cockpit.noOverdue}</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-brand-red-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-brand-red-50 text-[10px] font-semibold uppercase text-brand-red-700">
                  <tr>
                    <th className="px-3 py-2">{locale === "zh" ? "标题" : "Libelle"}</th>
                    <th className="px-3 py-2">{locale === "zh" ? "应收日期" : "Echeance"}</th>
                    <th className="px-3 py-2 text-right">{t.cockpit.outstanding}</th>
                    <th className="px-3 py-2 text-right">{t.cockpit.overdueDays}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-warm-400">
                  {overdueTop10.map(r => {
                    const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                    const od = Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000);
                    return (
                      <tr key={r.id} className="bg-brand-red-50/20 transition-colors hover:bg-brand-red-50/40">
                        <td className="px-3 py-1.5 text-brand-ink-700 max-w-[140px] truncate">{r.title}</td>
                        <td className="px-3 py-1.5 text-brand-ink-400">{r.due_date}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-brand-red-600">{formatXof(os)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-brand-red-500">+{od}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <SectionTitle>{t.sections.outstandingRanking}</SectionTitle>
          {outstandingTop10.length === 0 ? (
            <p className="text-xs text-brand-ink-300">{t.cockpit.noOutstanding}</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-brand-orange-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-brand-orange-50 text-[10px] font-semibold uppercase text-brand-orange-700">
                  <tr>
                    <th className="px-3 py-2">{locale === "zh" ? "标题" : "Libelle"}</th>
                    <th className="px-3 py-2">{locale === "zh" ? "应收日期" : "Echeance"}</th>
                    <th className="px-3 py-2 text-right">{t.cockpit.outstanding}</th>
                    <th className="px-3 py-2 text-right">{locale === "zh" ? "状态" : "Statut"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-warm-400">
                  {outstandingTop10.map(r => {
                    const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                    const statusLabels: Record<string, string> = locale === "zh"
                      ? { pending: "待收", partial: "部分", overdue: "逾期" }
                      : { pending: "Attente", partial: "Partiel", overdue: "Retard" };
                    return (
                      <tr key={r.id} className="transition-colors hover:bg-brand-orange-50/40">
                        <td className="px-3 py-1.5 text-brand-ink-700 max-w-[140px] truncate">{r.title}</td>
                        <td className="px-3 py-1.5 text-brand-ink-400">{r.due_date}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-brand-orange-700">{formatXof(os)}</td>
                        <td className="px-3 py-1.5 text-right">
                          <span className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            r.status === "overdue" ? "bg-brand-red-100 text-brand-red-700" :
                            r.status === "partial" ? "bg-brand-amber-100 text-amber-700" :
                            "bg-brand-warm-100 text-brand-ink-600",
                          )}>
                            {statusLabels[r.status] ?? r.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Section 5.5: Data health */}
      {qualityIssues && qualityIssues.length > 0 && (
        <div className="mb-8">
          <QualityDashboardWidget issues={qualityIssues} locale={locale} variant="management" />
        </div>
      )}

      {/* Section 6: Risk alerts */}
      <SectionTitle>{t.sections.riskAlerts}</SectionTitle>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RiskCard
          icon={AlertTriangle}
          label={t.risks.cleaningPending}
          value={`${risks.cleaning} ${t.risks.rooms}`}
          warn={risks.cleaning > 0}
        />
        <RiskCard
          icon={AlertTriangle}
          label={t.risks.maintenanceLocked}
          value={`${risks.maintenance} ${t.risks.rooms}`}
          warn={risks.maintenance > 0}
        />
        <RiskCard
          icon={AlertTriangle}
          label={t.risks.leaseExpiring}
          value={`${risks.leaseExpiring.length} ${t.risks.contracts}`}
          warn={risks.leaseExpiring.length > 0}
          detail={risks.leaseExpiring.map(l => l.contract_no).join(", ")}
        />
        <RiskCard
          icon={AlertTriangle}
          label={t.risks.saleInstallments}
          value={`${risks.saleWithPending.length} ${t.risks.contracts}`}
          warn={risks.saleWithPending.length > 0}
          detail={risks.saleWithPending.map(s => s.contract_no).join(", ")}
        />
      </div>
      {(risks.cleaning === 0 && risks.maintenance === 0 && risks.leaseExpiring.length === 0 && risks.saleWithPending.length === 0) && (
        <p className="text-sm text-brand-green-600 font-medium">{t.risks.none}</p>
      )}

      {/* Quick links */}
      <div className="mt-8 flex flex-wrap gap-2 text-xs text-brand-ink-400">
        <QuickLink href="/daily-rentals/overview" locale={locale} label={dictionaries[locale].shell.nav.dailyOccupancy ?? ""} />
        <QuickLink href="/leases" locale={locale} label={dictionaries[locale].shell.nav.leases ?? ""} />
        <QuickLink href="/sales" locale={locale} label={dictionaries[locale].shell.nav.sales ?? ""} />
        <QuickLink href="/finance" locale={locale} label={dictionaries[locale].shell.nav.finance ?? ""} />
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 text-[13px] font-semibold text-brand-ink-600">{children}</h2>;
}

function BuildingTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-fast",
        active
          ? "border-brand-orange bg-brand-orange-50 text-brand-orange-700"
          : "border-brand-warm-400 bg-white text-brand-ink-500 hover:bg-brand-warm-50",
      )}
    >
      {label}
    </button>
  );
}

function MiniStat2({ label, value, accent }: { label: string; value: string; accent: string }) {
  const borderColor: Record<string, string> = {
    ink: "border-brand-ink-700",
    green: "border-brand-green-500",
    orange: "border-brand-orange",
    red: "border-brand-red-500",
  };
  return (
    <div className={cn("rounded-lg border border-brand-warm-400 bg-white px-3 py-2 border-l-[3px]", borderColor[accent] ?? "border-brand-ink-700")}>
      <p className="text-[10px] text-brand-ink-300">{label}</p>
      <p className="text-sm font-bold tabular-nums text-brand-ink-900">{value}</p>
    </div>
  );
}

function RiskCard({ icon: Icon, label, value, warn, detail }: {
  icon: typeof AlertTriangle; label: string; value: string; warn: boolean; detail?: string;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-4 transition-colors",
      warn ? "border-brand-red-200 bg-brand-red-50/40" : "border-brand-warm-300 bg-white",
    )}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", warn ? "text-brand-red-500" : "text-brand-ink-300")} />
        <span className="text-xs font-medium text-brand-ink-600">{label}</span>
      </div>
      <p className={cn("mt-1.5 text-xl font-bold tabular-nums", warn ? "text-brand-red-700" : "text-brand-ink-700")}>{value}</p>
      {detail && <p className="mt-0.5 text-[10px] text-brand-ink-400 truncate">{detail}</p>}
    </div>
  );
}

function QuickLink({ href, locale, label }: { href: string; locale: Locale; label: string }) {
  return (
    <Link href={routeFor(locale, href)} className="flex items-center gap-1 text-brand-orange hover:underline">
      {label} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}
