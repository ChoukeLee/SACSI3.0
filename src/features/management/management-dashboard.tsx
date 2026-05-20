"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, CheckCircle2, Banknote,
} from "lucide-react";
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

// ── Status colour system — operational state identifiers ──────────────
// Each status has a distinct, scannable background colour.
// Cells must be distinguishable at a glance from across the room.
// Uses Tailwind native palette for stronger colour differentiation:
//   sold    → slate   (neutral, permanent, no action)
//   leased  → amber   (occupied long-term, warm)
//   daily   → orange  (active use, energetic)
//   reserve → blue    (pending arrival, calm)
//   clean   → cyan    (service required, distinct from blue)
//   maint   → red     (blocked, attention)
//   avail   → emerald (ready, positive)
//
// bg: room cell  dot: legend  pill: summary badge  ring: depth

const STATUS_CELL: Record<MgmtStatus, { bg: string; dot: string; pill: string; ring: string }> = {
  sold: {
    bg:   "bg-slate-200 text-slate-700 border-slate-300",
    dot:  "bg-slate-500",
    pill: "bg-slate-100 text-slate-700 border-slate-300",
    ring: "",
  },
  leased: {
    bg:   "bg-amber-200 text-amber-800 border-amber-300",
    dot:  "bg-amber-500",
    pill: "bg-amber-100 text-amber-800 border-amber-300",
    ring: "",
  },
  dailyOccupied: {
    bg:   "bg-orange-200 text-orange-800 border-orange-400",
    dot:  "bg-orange-500",
    pill: "bg-orange-100 text-orange-800 border-orange-400",
    ring: "ring-1 ring-inset ring-orange-400/40",
  },
  reserved: {
    bg:   "bg-blue-200 text-blue-800 border-blue-300",
    dot:  "bg-blue-500",
    pill: "bg-blue-100 text-blue-800 border-blue-300",
    ring: "",
  },
  cleaningPending: {
    bg:   "bg-cyan-200 text-cyan-800 border-cyan-300",
    dot:  "bg-cyan-500",
    pill: "bg-cyan-100 text-cyan-800 border-cyan-300",
    ring: "",
  },
  maintenance: {
    bg:   "bg-red-200 text-red-700 border-red-300",
    dot:  "bg-red-500",
    pill: "bg-red-100 text-red-700 border-red-300",
    ring: "",
  },
  available: {
    bg:   "bg-emerald-200 text-emerald-800 border-emerald-300",
    dot:  "bg-emerald-500",
    pill: "bg-emerald-100 text-emerald-800 border-emerald-300",
    ring: "",
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

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
      groups.set(key, { key, label, sortValue: floor ?? Number.MAX_SAFE_INTEGER, states: [] });
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
  const hasActiveSale = saleContracts.some(s => s.unit_id === unit.id && s.status === "active");
  if (unit.status === "sold" || hasActiveSale) return { unit, status: "sold" };

  const hasActiveLease = leaseContracts.some(l => l.unit_id === unit.id && l.status === "active");
  if (unit.status === "leased" || hasActiveLease) return { unit, status: "leased" };

  const hasCheckedIn = dailyBookings.some(b => b.unit_id === unit.id && b.status === "checked_in");
  if (unit.status === "daily_occupied" || hasCheckedIn) return { unit, status: "dailyOccupied" };

  const hasReservedBooking = dailyBookings.some(b => b.unit_id === unit.id && (b.status === "pending_review" || b.status === "confirmed"));
  if (unit.status === "reserved" || hasReservedBooking) return { unit, status: "reserved" };

  const hasPendingCleaning = cleaningTasks.some(t => t.unit_id === unit.id && !t.is_completed);
  if (unit.status === "cleaning_pending" || hasPendingCleaning) return { unit, status: "cleaningPending" };

  if (unit.status === "maintenance" || unit.status === "locked") return { unit, status: "maintenance" };

  return { unit, status: "available" };
}

// ── Component ──────────────────────────────────────────────────────────

export function ManagementDashboard({
  buildings, units, dailyBookings, leaseContracts, saleContracts,
  saleSchedules, cleaningTasks, ledgerEntries, receivables, qualityIssues, locale,
}: Props) {
  const t = dictionaries[locale].management;
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>("__all__");

  const residentialUnits = useMemo(
    () => units.filter(u => u.kind === "apartment"),
    [units],
  );

  const activeBuildings = useMemo(
    () => buildings.filter(b => b.is_active),
    [buildings],
  );

  const filteredUnits = useMemo(() => {
    if (selectedBuildingId === "__all__") return residentialUnits;
    return residentialUnits.filter(u => u.building_id === selectedBuildingId);
  }, [residentialUnits, selectedBuildingId]);

  const buildingUnits = useMemo(() => {
    const map = new Map<string, UnitRow[]>();
    for (const b of activeBuildings) map.set(b.id, residentialUnits.filter(u => u.building_id === b.id));
    return map;
  }, [activeBuildings, residentialUnits]);

  // Unit states & counts
  const unitStates = useMemo(
    () => filteredUnits.map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks)),
    [filteredUnits, dailyBookings, leaseContracts, saleContracts, cleaningTasks],
  );

  const counts = useMemo(() => {
    const c: Record<MgmtStatus, number> = {
      sold: 0, leased: 0, dailyOccupied: 0, reserved: 0,
      cleaningPending: 0, maintenance: 0, available: 0,
    };
    for (const s of unitStates) c[s.status]++;
    return c;
  }, [unitStates]);

  // Finance — current month
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const finance = useMemo(() => {
    const monthEntries = ledgerEntries.filter(e => e.entry_date.startsWith(monthPrefix));
    const income = monthEntries.filter(e => e.direction === "income").reduce((s, e) => s + Number(e.amount_xof), 0);
    const expense = monthEntries.filter(e => e.direction === "expense").reduce((s, e) => s + Number(e.amount_xof), 0);
    const dailyRental = monthEntries.filter(e => e.direction === "income" && e.category === "daily_rental").reduce((s, e) => s + Number(e.amount_xof), 0);
    const leaseRent = monthEntries.filter(e => e.direction === "income" && e.category === "lease_rent").reduce((s, e) => s + Number(e.amount_xof), 0);
    const sale = monthEntries.filter(e => e.direction === "income" && e.category === "sale").reduce((s, e) => s + Number(e.amount_xof), 0);
    const deposit = monthEntries.filter(e => e.direction === "liability_in").reduce((s, e) => s + Number(e.amount_xof), 0);
    return { income, expense, net: income - expense, dailyRental, leaseRent, sale, deposit };
  }, [ledgerEntries]);

  // Receivables
  const receivableStats = useMemo(() => calculateReceivableSummary(receivables), [receivables]);
  const receivableMonthStats = useMemo(() => calculateReceivableSummary(receivables, { currentMonth: true }), [receivables]);
  const receivableByBiz = useMemo(() => calculateReceivableByBusinessType(receivables, { currentMonth: true }), [receivables]);
  const receivableByBldg = useMemo(
    () => calculateReceivableByBuilding(receivables, activeBuildings, residentialUnits, ledgerEntries),
    [receivables, activeBuildings, residentialUnits, ledgerEntries],
  );

  const overdueTop10 = useMemo(() => getOverdueReceivables(receivables, 10), [receivables]);
  const outstandingTop10 = useMemo(() => getOutstandingReceivables(receivables, 10), [receivables]);

  // Lookups
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
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    const leaseExpiring = leaseContracts.filter(
      l => l.status === "active" && l.expected_end_date >= todayStr && l.expected_end_date <= cutoffStr,
    );
    const activeSales = saleContracts.filter(s => s.status === "active");
    const saleWithPending = activeSales.filter(s =>
      saleSchedules.some(sch => sch.sale_contract_id === s.id && sch.status !== "paid"),
    );
    return { cleaning, maintenance, leaseExpiring, saleWithPending };
  }, [unitStates, leaseContracts, saleContracts, saleSchedules]);

  const hasAnyRisk = risks.cleaning > 0 || risks.maintenance > 0 || risks.leaseExpiring.length > 0 || risks.saleWithPending.length > 0;

  const [showDetailTables, setShowDetailTables] = useState(false);

  const buildingName = selectedBuildingId === "__all__"
    ? t.allBuildings
    : activeBuildings.find(b => b.id === selectedBuildingId)?.display_name ?? "";

  return (
    <div className="-my-6 bg-slate-50/70">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-6">

        <PageHeader title={t.title} description={t.description} />

        {/* ── Building selector — segmented control ── */}
        <div className="mb-6">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 gap-0.5 flex-wrap">
            <SegmentedTab
              active={selectedBuildingId === "__all__"}
              onClick={() => setSelectedBuildingId("__all__")}
              label={t.allBuildings}
            />
            {activeBuildings.map(b => (
              <SegmentedTab
                key={b.id}
                active={selectedBuildingId === b.id}
                onClick={() => setSelectedBuildingId(b.id)}
                label={b.display_name}
              />
            ))}
          </div>
        </div>

        {/* ── Section 1: Core KPI Summary ── */}
        <div className="mb-8 grid gap-4 grid-cols-2 lg:grid-cols-4">
          <KPICard
            label={t.cockpit.receivableThisMonth}
            value={formatXof(receivableMonthStats.totalReceivable)}
            variant="neutral"
          />
          <KPICard
            label={t.cockpit.paidThisMonth}
            value={formatXof(receivableMonthStats.totalPaid)}
            variant="positive"
          />
          <KPICard
            label={t.cockpit.outstandingThisMonth}
            value={formatXof(receivableMonthStats.outstanding)}
            variant="warning"
          />
          <KPICard
            label={t.cockpit.overdueThisMonth}
            value={formatXof(receivableMonthStats.overdue)}
            variant="danger"
          />
        </div>

        {/* ── Section 2: Risk alerts ── */}
        <SectionLabel>{t.sections.riskAlerts}</SectionLabel>
        {hasAnyRisk ? (
          <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <RiskAlert label={t.risks.cleaningPending} value={risks.cleaning} unit={t.risks.rooms} active={risks.cleaning > 0} />
            <RiskAlert label={t.risks.maintenanceLocked} value={risks.maintenance} unit={t.risks.rooms} active={risks.maintenance > 0} />
            <RiskAlert label={t.risks.leaseExpiring} value={risks.leaseExpiring.length} unit={t.risks.contracts} active={risks.leaseExpiring.length > 0} />
            <RiskAlert label={t.risks.saleInstallments} value={risks.saleWithPending.length} unit={t.risks.contracts} active={risks.saleWithPending.length > 0} />
          </div>
        ) : (
          <div className="mb-8 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-5 py-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <p className="text-sm font-medium text-emerald-700">{t.risks.none}</p>
          </div>
        )}

        {/* ── Section 3: Status pills + Room matrix ── */}
        <SectionLabel>{t.sections.buildingStatus} — {buildingName}</SectionLabel>

        {/* Status summary pills */}
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {(Object.keys(counts) as MgmtStatus[]).map(s => (
            <div key={s} className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
              STATUS_CELL[s].pill,
            )}>
              <span className="tabular-nums">{counts[s]}</span>
              <span className="opacity-75 font-normal">{t.statuses[s]}</span>
            </div>
          ))}
        </div>

        {/* Room matrix */}
        <div className="mb-10 space-y-5">
          {(selectedBuildingId === "__all__" ? activeBuildings : activeBuildings.filter(b => b.id === selectedBuildingId)).map(building => {
            const bUnits = buildingUnits.get(building.id) ?? [];
            const bStates = sortUnits(bUnits).map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks));
            const floorGroups = groupStatesByFloor(bStates, locale);

            const bCounts: Record<string, number> = {};
            for (const s of bStates) bCounts[s.status] = (bCounts[s.status] ?? 0) + 1;

            return (
              <div key={building.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {/* Building header */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/60">
                  <div className="flex items-center gap-2.5">
                    <h4 className="text-sm font-bold text-slate-800">{building.display_name}</h4>
                    <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {bStates.length} {locale === "zh" ? "间" : "unités"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                    {(Object.keys(t.statuses) as MgmtStatus[]).filter(s => (bCounts[s] ?? 0) > 0).map(s => (
                      <span key={s} className="flex items-center gap-1.5 text-slate-500">
                        <span className={cn("h-2 w-2 rounded-sm", STATUS_CELL[s].dot)} />
                        {t.statuses[s]}
                        <span className="tabular-nums text-slate-400">{(bCounts[s] ?? 0)}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Floor groups */}
                <div className="px-4 py-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {floorGroups.map(group => (
                      <div key={group.key} className="rounded-lg border border-slate-100 bg-white p-3">
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
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
                                  "flex h-11 w-11 items-center justify-center rounded-lg",
                                  "border",
                                  "font-mono text-xs font-bold leading-none",
                                  "shadow-sm transition-all duration-150",
                                  "hover:-translate-y-0.5 hover:shadow-md active:scale-95",
                                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
                                  st.bg,
                                  st.ring,
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

        {/* ── Section 4: Finance overview ── */}
        <SectionLabel>{t.sections.financeOverview}</SectionLabel>
        <div className="mb-8 grid gap-4 grid-cols-2 lg:grid-cols-3">
          <FinanceCard
            label={t.finance.income}
            value={formatXof(finance.income)}
            icon={TrendingUp}
            tone="positive"
          />
          <FinanceCard
            label={t.finance.expense}
            value={formatXof(finance.expense)}
            icon={TrendingDown}
            tone="negative"
          />
          <FinanceCard
            label={t.finance.net}
            value={formatXof(finance.net)}
            icon={Banknote}
            tone={finance.net >= 0 ? "positive" : "negative"}
          />
        </div>

        {/* ── Section 5: Receivable leaderboards ── */}
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          {/* Overdue top 10 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {t.sections.overdueRanking}
              </h3>
            </div>
            {overdueTop10.length === 0 ? (
              <p className="text-xs text-slate-400 italic">{t.cockpit.noOverdue}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-red-50/70 text-[10px] font-semibold uppercase text-red-600">
                    <tr>
                      <th className="px-3 py-2.5">{locale === "zh" ? "标题" : "Libelle"}</th>
                      <th className="px-3 py-2.5">{locale === "zh" ? "应收日期" : "Echeance"}</th>
                      <th className="px-3 py-2.5 text-right">{t.cockpit.outstanding}</th>
                      <th className="px-3 py-2.5 text-right">{t.cockpit.overdueDays}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overdueTop10.map(r => {
                      const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                      const od = Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000);
                      return (
                        <tr key={r.id} className="transition-colors hover:bg-red-50/30">
                          <td className="px-3 py-2 text-slate-700 max-w-[140px] truncate">{r.title}</td>
                          <td className="px-3 py-2 text-slate-400">{r.due_date}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">{formatXof(os)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-500 font-medium">+{od}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Outstanding top 10 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {t.sections.outstandingRanking}
              </h3>
            </div>
            {outstandingTop10.length === 0 ? (
              <p className="text-xs text-slate-400 italic">{t.cockpit.noOutstanding}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-amber-50/70 text-[10px] font-semibold uppercase text-amber-700">
                    <tr>
                      <th className="px-3 py-2.5">{locale === "zh" ? "标题" : "Libelle"}</th>
                      <th className="px-3 py-2.5">{locale === "zh" ? "应收日期" : "Echeance"}</th>
                      <th className="px-3 py-2.5 text-right">{t.cockpit.outstanding}</th>
                      <th className="px-3 py-2.5 text-right">{locale === "zh" ? "状态" : "Statut"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {outstandingTop10.map(r => {
                      const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                      const statusLabels: Record<string, string> = locale === "zh"
                        ? { pending: "待收", partial: "部分", overdue: "逾期" }
                        : { pending: "Attente", partial: "Partiel", overdue: "Retard" };
                      const statusStyle: Record<string, string> = {
                        overdue: "bg-red-100 text-red-700",
                        partial: "bg-amber-100 text-amber-700",
                        pending: "bg-slate-100 text-slate-600",
                      };
                      return (
                        <tr key={r.id} className="transition-colors hover:bg-slate-50">
                          <td className="px-3 py-2 text-slate-700 max-w-[140px] truncate">{r.title}</td>
                          <td className="px-3 py-2 text-slate-400">{r.due_date}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-700">{formatXof(os)}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              statusStyle[r.status] ?? "bg-slate-100 text-slate-600",
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

        {/* ── Section 6: Data quality ── */}
        {qualityIssues && qualityIssues.length > 0 && (
          <div className="mb-8">
            <QualityDashboardWidget issues={qualityIssues} locale={locale} variant="management" />
          </div>
        )}

        {/* ── Section 7: Receivable by business type ── */}
        {receivableByBiz.length > 0 && (
          <div className="mb-6">
            <button
              onClick={() => setShowDetailTables(!showDetailTables)}
              className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-colors"
            >
              {t.sections.receivableByBusiness}
              {showDetailTables ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showDetailTables && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full min-w-[400px] text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5">{locale === "zh" ? "业务类型" : "Type"}</th>
                      <th className="px-3 py-2.5 text-right">{t.cockpit.receivable}</th>
                      <th className="px-3 py-2.5 text-right">{t.cockpit.paid}</th>
                      <th className="px-3 py-2.5 text-right">{t.cockpit.outstanding}</th>
                      <th className="px-3 py-2.5 text-right">{t.cockpit.overdue}</th>
                      <th className="px-3 py-2.5 text-right">{t.cockpit.collectionRate}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {receivableByBiz.map(biz => {
                      const rate = biz.totalReceivable > 0 ? (biz.totalPaid / biz.totalReceivable * 100) : 0;
                      const bizLabels: Record<string, string> = {
                        daily_booking: t.cockpit.dailyRental,
                        lease_contract: t.cockpit.leaseRental,
                        sale_contract: t.cockpit.sale,
                        manual: t.cockpit.other,
                      };
                      return (
                        <tr key={biz.businessType} className="transition-colors hover:bg-slate-50">
                          <td className="px-3 py-2.5 font-medium text-slate-700">{bizLabels[biz.businessType] ?? biz.businessType}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{formatXof(biz.totalReceivable)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600">{formatXof(biz.totalPaid)}</td>
                          <td className={cn("px-3 py-2.5 text-right tabular-nums font-medium", biz.outstanding > 0 ? "text-red-600" : "text-emerald-600")}>{formatXof(biz.outstanding)}</td>
                          <td className={cn("px-3 py-2.5 text-right tabular-nums", biz.overdue > 0 ? "text-red-600 font-medium" : "text-slate-300")}>{formatXof(biz.overdue)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{rate.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Section 8: Receivable by building ── */}
        <div className="mb-8">
          <button
            onClick={() => setShowDetailTables(!showDetailTables)}
            className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-colors"
          >
            {t.sections.receivableByBuilding}
            {showDetailTables ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showDetailTables && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[800px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">{t.cockpit.building}</th>
                    <th className="px-3 py-2.5 text-right">{t.cockpit.totalUnits}</th>
                    <th className="px-3 py-2.5 text-right">{t.cockpit.receivable}</th>
                    <th className="px-3 py-2.5 text-right">{t.cockpit.paid}</th>
                    <th className="px-3 py-2.5 text-right">{t.cockpit.outstanding}</th>
                    <th className="px-3 py-2.5 text-right">{t.cockpit.overdue}</th>
                    <th className="px-3 py-2.5 text-right">{t.cockpit.collectionRate}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receivableByBldg.map(b => (
                    <tr key={b.buildingId ?? "__unassigned__"} className="transition-colors hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-700">{b.buildingName === "unassigned" ? t.cockpit.unassigned : b.buildingName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{b.totalUnits || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{formatXof(b.totalReceivable)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600">{formatXof(b.totalPaid)}</td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums font-medium", b.outstanding > 0 ? "text-red-600" : "text-emerald-600")}>{formatXof(b.outstanding)}</td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", b.overdue > 0 ? "text-red-600 font-medium" : "text-slate-300")}>{formatXof(b.overdue)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{(b.collectionRate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Quick links ── */}
        <div className="flex flex-wrap gap-3 text-xs text-slate-400">
          <QuickLink href="/daily-rentals/overview" locale={locale} label={dictionaries[locale].shell.nav.dailyOccupancy ?? ""} />
          <QuickLink href="/leases" locale={locale} label={dictionaries[locale].shell.nav.leases ?? ""} />
          <QuickLink href="/sales" locale={locale} label={dictionaries[locale].shell.nav.sales ?? ""} />
          <QuickLink href="/finance" locale={locale} label={dictionaries[locale].shell.nav.finance ?? ""} />
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </h2>
  );
}

function SegmentedTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg px-4 py-2 text-sm font-medium transition-all duration-fast",
        active
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-500 hover:text-slate-700",
      )}
    >
      {label}
    </button>
  );
}

function KPICard({ label, value, variant }: {
  label: string; value: string;
  variant: "neutral" | "positive" | "warning" | "danger";
}) {
  const styles: Record<string, { bg: string; text: string; dot: string }> = {
    neutral:  { bg: "bg-white border-slate-200", text: "text-slate-900", dot: "bg-slate-400" },
    positive: { bg: "bg-white border-slate-200", text: "text-emerald-700", dot: "bg-emerald-500" },
    warning:  { bg: "bg-white border-slate-200", text: "text-amber-700", dot: "bg-amber-500" },
    danger:   { bg: "bg-white border-slate-200", text: "text-red-700", dot: "bg-red-500" },
  };
  const s = styles[variant];
  return (
    <div className={cn("rounded-xl border bg-white shadow-sm overflow-hidden", s.bg)}>
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{label}</p>
        </div>
        <p className={cn("text-[26px] font-semibold tracking-tight tabular-nums", s.text)}>
          {value}
        </p>
      </div>
    </div>
  );
}

function FinanceCard({ label, value, icon: Icon, tone }: {
  label: string; value: string;
  icon: typeof TrendingUp;
  tone: "positive" | "negative";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{label}</p>
        <Icon className={cn(
          "h-4 w-4",
          tone === "positive" ? "text-emerald-500" : "text-red-400",
        )} />
      </div>
      <p className={cn(
        "text-[22px] font-semibold tracking-tight tabular-nums",
        tone === "positive" ? "text-slate-900" : "text-red-600",
      )}>
        {value}
      </p>
    </div>
  );
}

function RiskAlert({ label, value, unit, active }: {
  label: string; value: number; unit: string; active: boolean;
}) {
  return (
    <div className={cn(
      "rounded-xl border px-4 py-3.5 transition-colors",
      active
        ? "border-red-200 bg-red-50/60"
        : "border-slate-200 bg-white",
    )}>
      <div className="flex items-center gap-2 mb-1.5">
        {active && <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />}
        <span className={cn(
          "text-[11px] font-medium uppercase tracking-wider",
          active ? "text-red-600" : "text-slate-400",
        )}>
          {label}
        </span>
      </div>
      <p className={cn(
        "text-xl font-bold tabular-nums",
        active ? "text-red-700" : "text-slate-400",
      )}>
        {value} <span className="text-sm font-normal">{unit}</span>
      </p>
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
