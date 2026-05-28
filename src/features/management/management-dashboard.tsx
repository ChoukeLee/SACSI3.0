"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
} from "lucide-react";
import {
  calculateReceivableSummary,
} from "@/features/finance/receivable-summary";
import { getDailyRoomStateForDate } from "@/features/daily-rentals/room-status";
import { FinanceDetailPanel } from "./finance-detail-panel";
import { QualityDashboardWidget } from "@/features/data-quality";
import type { QualityIssue } from "@/features/data-quality/quality-types";
import type { Locale, ManagementDict } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { formatXof, cn, sortUnits } from "@/lib/utils";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, LedgerEntryRow, ReceivableRow,
  PaymentRow, CustomerRow,
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
  payments: PaymentRow[];
  customers: CustomerRow[];
  qualityIssues?: QualityIssue[];
  t: ManagementDict;
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

const STATUS_CELL: Record<MgmtStatus, { bg: string; dot: string; pill: string; ring: string; stripe: string }> = {
  sold: {
    bg:   "bg-brand-warm-100 text-brand-ink-800 border-brand-warm-300",
    dot:  "bg-brand-stone-500",
    pill: "bg-brand-warm-100 text-brand-ink-700 border-brand-warm-300",
    ring: "",
    stripe: "bg-brand-stone-700",
  },
  leased: {
    bg:   "bg-brand-purple-50 text-brand-purple-800 border-brand-purple-200",
    dot:  "bg-brand-purple-500",
    pill: "bg-brand-purple-50 text-brand-purple-700 border-brand-purple-200",
    ring: "",
    stripe: "bg-brand-purple-700",
  },
  dailyOccupied: {
    bg:   "bg-brand-indigo-50 text-brand-indigo-800 border-brand-indigo-200",
    dot:  "bg-brand-indigo-500",
    pill: "bg-brand-indigo-50 text-brand-indigo-700 border-brand-indigo-200",
    ring: "ring-1 ring-inset ring-brand-indigo-300/50",
    stripe: "bg-brand-indigo-700",
  },
  reserved: {
    bg:   "bg-brand-amber-50 text-brand-amber-800 border-brand-amber-200",
    dot:  "bg-brand-amber-500",
    pill: "bg-brand-amber-50 text-brand-amber-700 border-brand-amber-200",
    ring: "",
    stripe: "bg-brand-amber-700",
  },
  cleaningPending: {
    bg:   "bg-brand-cyan-50 text-brand-cyan-800 border-brand-cyan-200",
    dot:  "bg-brand-cyan-500",
    pill: "bg-brand-cyan-50 text-brand-cyan-700 border-brand-cyan-200",
    ring: "",
    stripe: "bg-brand-cyan-700",
  },
  maintenance: {
    bg:   "bg-brand-red-50 text-brand-red-800 border-brand-red-200",
    dot:  "bg-brand-red-500",
    pill: "bg-brand-red-50 text-brand-red-700 border-brand-red-200",
    ring: "",
    stripe: "bg-brand-red-700",
  },
  available: {
    bg:   "bg-brand-green-50 text-brand-green-800 border-brand-green-200",
    dot:  "bg-brand-green-500",
    pill: "bg-brand-green-50 text-brand-green-700 border-brand-green-200",
    ring: "",
    stripe: "bg-brand-green-700",
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
  dateStr: string,
): UnitState {
  const hasActiveSale = saleContracts.some(s => s.unit_id === unit.id && s.status === "active");
  if (unit.status === "sold" || hasActiveSale) return { unit, status: "sold" };

  const hasActiveLease = leaseContracts.some(l => l.unit_id === unit.id && l.status === "active");
  if (unit.status === "leased" || hasActiveLease) return { unit, status: "leased" };

  const dailyState = getDailyRoomStateForDate({ unit, dateStr, bookings: dailyBookings, cleaningTasks });
  if (dailyState.status === "occupied" || dailyState.status === "checking_out_today") return { unit, status: "dailyOccupied" };
  if (dailyState.status === "reserved") return { unit, status: "reserved" };
  if (dailyState.status === "cleaning") return { unit, status: "cleaningPending" };
  if (dailyState.status === "maintenance" || dailyState.status === "locked") return { unit, status: "maintenance" };

  return { unit, status: "available" };
}

// ── Component ──────────────────────────────────────────────────────────

export function ManagementDashboard({
  buildings, units, dailyBookings, leaseContracts, saleContracts,
  saleSchedules, cleaningTasks, ledgerEntries, receivables,
  payments, customers, qualityIssues, t, locale,
}: Props) {
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>("__all__");
  const [financeDetail, setFinanceDetail] = useState<"receivable" | "collected" | "outstanding" | "overdue" | null>(null);

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
  const todayStr = new Date().toISOString().slice(0, 10);

  const unitStates = useMemo(
    () => filteredUnits.map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks, todayStr)),
    [filteredUnits, dailyBookings, leaseContracts, saleContracts, cleaningTasks, todayStr],
  );

  const counts = useMemo(() => {
    const c: Record<MgmtStatus, number> = {
      sold: 0, leased: 0, dailyOccupied: 0, reserved: 0,
      cleaningPending: 0, maintenance: 0, available: 0,
    };
    for (const s of unitStates) c[s.status]++;
    return c;
  }, [unitStates]);

  // Finance — current month (exclude daily rental, which has its own page)
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const nonDailyReceivables = useMemo(
    () => receivables.filter(r => r.source_type !== "daily_booking"),
    [receivables],
  );

  const receivableMonthStats = useMemo(() => calculateReceivableSummary(nonDailyReceivables, { currentMonth: true }), [nonDailyReceivables]);

  const businessStats = useMemo(() => {
    const map = new Map<string, { totalReceivable: number; totalPaid: number; outstanding: number; overdue: number }>();
    const filtered = nonDailyReceivables.filter(r => r.status !== "cancelled" && r.due_date.startsWith(monthPrefix));
    for (const r of filtered) {
      const key = r.source_type === "lease_contract" ? "lease" : r.source_type === "sale_contract" ? "sale" : "other";
      let g = map.get(key);
      if (!g) { g = { totalReceivable: 0, totalPaid: 0, outstanding: 0, overdue: 0 }; map.set(key, g); }
      g.totalReceivable += Number(r.amount_xof);
      g.totalPaid += Number(r.paid_amount_xof);
      const unpaid = Number(r.amount_xof) - Number(r.paid_amount_xof);
      if (unpaid > 0 && r.due_date < new Date().toISOString().slice(0, 10)) g.overdue += unpaid;
    }
    for (const g of map.values()) g.outstanding = g.totalReceivable - g.totalPaid;
    return map;
  }, [nonDailyReceivables, monthPrefix]);

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

  const buildingName = selectedBuildingId === "__all__"
    ? t.allBuildings
    : activeBuildings.find(b => b.id === selectedBuildingId)?.display_name ?? "";

  return (
    <div className="-my-6 bg-brand-warm-100">
      <div className="mx-auto flex max-w-[1360px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">

        {/* ── Building selector — segmented control ── */}
        <div>
          <div className="inline-flex flex-wrap gap-0.5 rounded-2xl border border-brand-warm-300 bg-white p-1 shadow-sm">
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
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.72fr)]">
          <div className="rounded-2xl border border-brand-warm-200 bg-white p-4 shadow-natural">
            <div className="mb-3 flex items-center justify-between gap-3">
              <SectionLabel compact>{t.sections.financeOverview}</SectionLabel>
              <span className="rounded-full bg-brand-warm-100 px-2.5 py-1 text-xs font-semibold text-brand-ink-500">
                {monthPrefix}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <KPICard
                label={t.cockpit.receivableThisMonth}
                value={formatXof(receivableMonthStats.totalReceivable)}
                variant="neutral"
                onClick={() => setFinanceDetail("receivable")}
              />
              <KPICard
                label={t.cockpit.paidThisMonth}
                value={formatXof(receivableMonthStats.totalPaid)}
                variant="positive"
                onClick={() => setFinanceDetail("collected")}
              />
              <KPICard
                label={t.cockpit.outstandingThisMonth}
                value={formatXof(receivableMonthStats.outstanding)}
                variant="warning"
                onClick={() => setFinanceDetail("outstanding")}
              />
              <KPICard
                label={t.cockpit.overdueThisMonth}
                value={formatXof(receivableMonthStats.overdue)}
                variant="danger"
                onClick={() => setFinanceDetail("overdue")}
              />
            </div>

            {/* Business type sub-cards */}
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {(() => {
                const lease = businessStats.get("lease");
                const sale = businessStats.get("sale");
                return (
                  <>
                    {lease && (
                      <button type="button" onClick={() => setFinanceDetail("receivable")} className="rounded-xl border border-brand-warm-200 bg-white px-3.5 py-2.5 text-left transition-all hover:shadow-sm hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-brand-indigo-500">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-black text-brand-ink-600">{locale === "zh" ? "长租" : "Bail"}</span>
                          <span className="text-xs font-bold text-brand-ink-400">{locale === "zh" ? `${receivables.filter(r => r.source_type === "lease_contract" && r.status !== "cancelled" && r.due_date.startsWith(monthPrefix)).length}笔` : `${receivables.filter(r => r.source_type === "lease_contract" && r.status !== "cancelled" && r.due_date.startsWith(monthPrefix)).length} creances`}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
                          <span className="font-bold text-brand-ink-800">{locale === "zh" ? "应收" : "Du"} {formatXof(lease.totalReceivable)}</span>
                          <span className="text-brand-green-700">{locale === "zh" ? "已收" : "Enc"} {formatXof(lease.totalPaid)}</span>
                          {lease.outstanding > 0 && <span className="text-brand-indigo-700">{locale === "zh" ? "未收" : "Impaye"} {formatXof(lease.outstanding)}</span>}
                          {lease.overdue > 0 && <span className="text-brand-red-600">{locale === "zh" ? "逾期" : "Retard"} {formatXof(lease.overdue)}</span>}
                        </div>
                      </button>
                    )}
                    {sale && (
                      <button type="button" onClick={() => setFinanceDetail("receivable")} className="rounded-xl border border-brand-warm-200 bg-white px-3.5 py-2.5 text-left transition-all hover:shadow-sm hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-brand-indigo-500">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-black text-brand-ink-600">{locale === "zh" ? "售房" : "Vente"}</span>
                          <span className="text-xs font-bold text-brand-ink-400">{locale === "zh" ? `${receivables.filter(r => r.source_type === "sale_contract" && r.status !== "cancelled" && r.due_date.startsWith(monthPrefix)).length}笔` : `${receivables.filter(r => r.source_type === "sale_contract" && r.status !== "cancelled" && r.due_date.startsWith(monthPrefix)).length} creances`}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
                          <span className="font-bold text-brand-ink-800">{locale === "zh" ? "应收" : "Du"} {formatXof(sale.totalReceivable)}</span>
                          <span className="text-brand-green-700">{locale === "zh" ? "已收" : "Enc"} {formatXof(sale.totalPaid)}</span>
                          {sale.outstanding > 0 && <span className="text-brand-indigo-700">{locale === "zh" ? "未收" : "Impaye"} {formatXof(sale.outstanding)}</span>}
                          {sale.overdue > 0 && <span className="text-brand-red-600">{locale === "zh" ? "逾期" : "Retard"} {formatXof(sale.overdue)}</span>}
                        </div>
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          <div className="rounded-2xl border border-brand-warm-200 bg-white p-4 shadow-natural">
            <SectionLabel compact>{t.sections.buildingStatus}</SectionLabel>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(["sold", "leased", "dailyOccupied", "available", "cleaningPending", "maintenance"] as MgmtStatus[]).map(s => (
                <StatusSummaryCard
                  key={s}
                  label={t.statuses[s]}
                  value={counts[s]}
                  status={s}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Section 3: shadcn-style room status board */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionLabel compact>{t.sections.buildingStatus} - {buildingName}</SectionLabel>
            <p className="mt-1 text-xs text-brand-ink-500">
              {locale === "zh" ? "按楼层查看房间状态，点击房间可打开对应档案。" : "Statut par etage, cliquez pour ouvrir le dossier."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(counts) as MgmtStatus[]).map(s => (
              <div key={s} className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold shadow-sm",
                STATUS_CELL[s].pill,
              )}>
                <span className={cn("h-2 w-2 rounded-full", STATUS_CELL[s].dot)} />
                <span className="tabular-nums">{counts[s]}</span>
                <span className="opacity-75 font-normal">{t.statuses[s]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Room matrix */}
        <div className="space-y-5">
          {(selectedBuildingId === "__all__" ? activeBuildings : activeBuildings.filter(b => b.id === selectedBuildingId)).map(building => {
            const bUnits = buildingUnits.get(building.id) ?? [];
            const bStates = sortUnits(bUnits).map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks, todayStr));
            const floorGroups = groupStatesByFloor(bStates, locale);

            const bCounts: Record<string, number> = {};
            for (const s of bStates) bCounts[s.status] = (bCounts[s.status] ?? 0) + 1;

            return (
              <div key={building.id} className="overflow-hidden rounded-2xl border border-brand-warm-200 bg-white shadow-sm">
                {/* Building header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-warm-200 bg-white px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-brand-indigo" />
                    <h4 className="text-sm font-black text-brand-ink-900">{building.display_name}</h4>
                    <span className="rounded-full border border-brand-warm-200 bg-brand-warm-50 px-2 py-0.5 text-xs font-semibold text-brand-ink-500">
                      {bStates.length} {locale === "zh" ? "间" : "unités"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {(Object.keys(t.statuses) as MgmtStatus[]).filter(s => (bCounts[s] ?? 0) > 0).map(s => (
                      <span key={s} className="flex items-center gap-1.5 text-brand-ink-500">
                        <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_CELL[s].dot)} />
                        {t.statuses[s]}
                        <span className="tabular-nums text-brand-ink-400">{(bCounts[s] ?? 0)}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Floor groups */}
                <div className="bg-brand-warm-50/60 px-4 py-4">
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                    {floorGroups.map(group => (
                      <div key={group.key} className="rounded-2xl border border-brand-warm-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-xs font-bold text-brand-ink-500">{group.label}</p>
                          <span className="rounded-full bg-brand-warm-100 px-2 py-0.5 text-xs font-bold text-brand-ink-500">
                            {group.states.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {group.states.map(s => {
                            return (
                              <RoomStatusCard
                                key={s.unit.id}
                                state={s}
                                statusLabel={t.statuses[s.status]}
                                href={routeFor(locale, `/units/${s.unit.id}`)}
                                locale={locale}
                              />
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

        {/* Data quality */}
        {qualityIssues && (
          <QualityDashboardWidget issues={qualityIssues} locale={locale} variant="management" />
        )}

        {/* Finance detail slide-out panel */}
        <FinanceDetailPanel
          open={financeDetail}
          onClose={() => setFinanceDetail(null)}
          receivables={receivables}
          payments={payments}
          units={units}
          buildings={buildings}
          customers={customers}
          locale={locale}
        />

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

const ROOM_CARD: Record<MgmtStatus, { card: string; badge: string; dot: string; action: string; summary: string }> = {
  sold: {
    card: "border-brand-warm-300 bg-brand-warm-100 text-brand-ink-900",
    badge: "bg-white text-brand-ink-900 ring-1 ring-inset ring-brand-warm-300",
    dot: "bg-brand-neutral-500",
    action: "bg-white text-brand-ink-800 ring-brand-warm-300",
    summary: "border-brand-warm-300 bg-white text-brand-ink-900",
  },
  leased: {
    card: "border-brand-purple-200 bg-brand-purple-50 text-brand-purple-900",
    badge: "bg-white text-brand-purple-900 ring-1 ring-inset ring-brand-purple-200",
    dot: "bg-brand-purple-500",
    action: "bg-white text-brand-purple-800 ring-brand-purple-200",
    summary: "border-brand-purple-200 bg-brand-purple-50 text-brand-purple-900",
  },
  dailyOccupied: {
    card: "border-brand-indigo-200 bg-brand-indigo-50 text-brand-indigo-900",
    badge: "bg-white text-brand-indigo-900 ring-1 ring-inset ring-brand-indigo-200",
    dot: "bg-brand-indigo-500",
    action: "bg-white text-brand-indigo-800 ring-brand-indigo-200",
    summary: "border-brand-indigo-200 bg-brand-indigo-50 text-brand-indigo-900",
  },
  reserved: {
    card: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
    badge: "bg-white text-brand-amber-900 ring-1 ring-inset ring-brand-amber-200",
    dot: "bg-brand-amber-500",
    action: "bg-white text-brand-amber-800 ring-brand-amber-200",
    summary: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
  },
  cleaningPending: {
    card: "border-brand-cyan-200 bg-brand-cyan-50 text-brand-cyan-900",
    badge: "bg-white text-brand-cyan-900 ring-1 ring-inset ring-brand-cyan-200",
    dot: "bg-brand-cyan-500",
    action: "bg-white text-brand-cyan-800 ring-brand-cyan-200",
    summary: "border-brand-cyan-200 bg-brand-cyan-50 text-brand-cyan-900",
  },
  maintenance: {
    card: "border-brand-red-200 bg-brand-red-50 text-brand-red-900",
    badge: "bg-white text-brand-red-900 ring-1 ring-inset ring-brand-red-200",
    dot: "bg-brand-red-500",
    action: "bg-white text-brand-red-800 ring-brand-red-200",
    summary: "border-brand-red-200 bg-brand-red-50 text-brand-red-900",
  },
  available: {
    card: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
    badge: "bg-white text-brand-green-900 ring-1 ring-inset ring-brand-green-200",
    dot: "bg-brand-green-500",
    action: "bg-white text-brand-green-800 ring-brand-green-200",
    summary: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
  },
};

function RoomStatusCard({
  state, statusLabel, href, locale,
}: {
  state: UnitState;
  statusLabel: string;
  href: string;
  locale: Locale;
}) {
  const styles = ROOM_CARD[state.status];
  const roomText = locale === "zh" ? "房间档案" : "Dossier";

  return (
    <Link
      href={href}
      title={`${state.unit.unit_no} - ${statusLabel}`}
      aria-label={`${state.unit.unit_no} - ${statusLabel}`}
      className={cn(
        "group relative flex min-h-[92px] flex-col justify-between overflow-hidden rounded-2xl border p-3 shadow-sm",
        "transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lifted active:scale-[0.98]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo",
        styles.card,
      )}
    >
      <div className="relative z-10 flex items-start justify-between gap-2">
        <span className={cn("rounded-full px-2.5 py-1 font-mono text-xs font-black shadow-sm", styles.badge)}>
          {state.unit.unit_no}
        </span>
        <span className={cn("mt-1 h-2.5 w-2.5 rounded-full ring-2 ring-white/25", styles.dot)} />
      </div>
      <div className="relative z-10">
        <p className="truncate text-xs font-black text-current">{statusLabel}</p>
        <p className={cn("mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset backdrop-blur", styles.action)}>
          {roomText}
        </p>
      </div>
    </Link>
  );
}

function StatusSummaryCard({ label, value, status }: { label: string; value: number; status: MgmtStatus }) {
  const styles = ROOM_CARD[status];
  return (
    <div className={cn("min-h-[94px] rounded-2xl border px-3.5 py-3.5", styles.summary)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black opacity-90">{label}</span>
        <span className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-white/25", styles.dot)} />
      </div>
      <p className="mt-2 text-[28px] font-black leading-none text-current tabular-nums">{value}</p>
    </div>
  );
}

function SectionLabel({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <h2 className={cn(
      "text-xs font-black uppercase tracking-[0.14em] text-brand-ink-500",
      compact ? "mb-0" : "mb-4",
    )}>
      {children}
    </h2>
  );
}

function SegmentedTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-fast",
        active
          ? "bg-brand-indigo-500 text-white shadow-sm"
          : "text-brand-neutral-600 hover:bg-brand-indigo-50 hover:text-brand-indigo-800",
      )}
    >
      {label}
    </button>
  );
}

function KPICard({ label, value, variant, onClick }: {
  label: string; value: string;
  variant: "neutral" | "positive" | "warning" | "danger";
  onClick?: () => void;
}) {
  const styles: Record<string, { bg: string; text: string; dot: string; bar: string }> = {
    neutral:  { bg: "bg-white border-brand-neutral-600/40", text: "text-brand-neutral-950", dot: "bg-brand-neutral-700", bar: "bg-brand-neutral-950" },
    positive: { bg: "bg-white border-brand-green-500/40", text: "text-brand-green-700", dot: "bg-brand-green-500", bar: "bg-brand-green-500" },
    warning:  { bg: "bg-white border-brand-indigo-500/40", text: "text-brand-indigo-700", dot: "bg-brand-indigo-500", bar: "bg-brand-indigo-500" },
    danger:   { bg: "bg-white border-brand-red-500/40", text: "text-brand-red-700", dot: "bg-brand-red-500", bar: "bg-brand-red-500" },
  };
  const s = styles[variant];
  const isClickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      className={cn(
        "appearance-none flex min-h-[94px] overflow-hidden rounded-2xl border bg-white text-left transition-all duration-fast shadow-sm",
        s.bg,
        isClickable && "cursor-pointer hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo-500",
      )}
    >
      <div className={cn("w-1.5 shrink-0", s.bar)} />
      <div className="flex min-w-0 flex-1 flex-col justify-between px-4 py-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
          <p className="truncate text-xs font-bold uppercase tracking-[0.08em] text-brand-neutral-800">{label}</p>
        </div>
        <p className={cn("truncate text-[24px] font-black tracking-tight tabular-nums", s.text)}>
          {value}
        </p>
      </div>
    </button>
  );
}

function RiskAlert({ label, value, unit, active, compact = false }: {
  label: string; value: number; unit: string; active: boolean; compact?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-xl border transition-colors",
      compact ? "px-3 py-2.5" : "px-4 py-3.5",
      active
        ? "border-brand-red-200 bg-brand-red-50"
        : "border-brand-warm-200 bg-white",
    )}>
      <div className="mb-1.5 flex items-center gap-2">
        {active && <AlertTriangle className="h-4 w-4 text-brand-red-500 shrink-0" />}
        <span className={cn(
          "text-xs font-medium uppercase tracking-[0.14em]",
          active ? "text-brand-red-600" : "text-brand-ink-400",
        )}>
          {label}
        </span>
      </div>
      <p className={cn(
        compact ? "text-lg font-black tabular-nums" : "text-xl font-black tabular-nums",
        active ? "text-brand-red-700" : "text-brand-ink-400",
      )}>
        {value} <span className="text-sm font-normal">{unit}</span>
      </p>
    </div>
  );
}
