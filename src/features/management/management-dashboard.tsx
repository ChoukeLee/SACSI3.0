"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight,
  CheckCircle2,
} from "lucide-react";
import {
  calculateReceivableSummary,
} from "@/features/finance/receivable-summary";
import { QualityDashboardWidget } from "@/features/data-quality";
import type { QualityIssue } from "@/features/data-quality/quality-types";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { formatXof, cn, sortUnits } from "@/lib/utils";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, LedgerEntryRow, ReceivableRow,
} from "@/types/database";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Status colour system â€” operational state identifiers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Each status has a distinct, scannable background colour.
// Cells must be distinguishable at a glance from across the room.
// Uses Tailwind native palette for stronger colour differentiation:
//   sold    â†’ slate   (neutral, permanent, no action)
//   leased  â†’ amber   (occupied long-term, warm)
//   daily   â†’ orange  (active use, energetic)
//   reserve â†’ blue    (pending arrival, calm)
//   clean   â†’ cyan    (service required, distinct from blue)
//   maint   â†’ red     (blocked, attention)
//   avail   â†’ emerald (ready, positive)
//
// bg: room cell  dot: legend  pill: summary badge  ring: depth

const STATUS_CELL: Record<MgmtStatus, { bg: string; dot: string; pill: string; ring: string; stripe: string }> = {
  sold: {
    bg:   "bg-slate-600 text-white border-slate-700 shadow-slate-200",
    dot:  "bg-slate-600",
    pill: "bg-slate-100 text-slate-700 border-slate-300",
    ring: "",
    stripe: "bg-slate-700",
  },
  leased: {
    bg:   "bg-indigo-600 text-white border-indigo-700 shadow-indigo-200",
    dot:  "bg-indigo-600",
    pill: "bg-indigo-50 text-indigo-700 border-indigo-200",
    ring: "",
    stripe: "bg-indigo-800",
  },
  dailyOccupied: {
    bg:   "bg-brand-orange-500 text-white border-brand-orange-600 shadow-brand-orange-200",
    dot:  "bg-brand-orange-500",
    pill: "bg-brand-orange-50 text-brand-orange-700 border-brand-orange-200",
    ring: "ring-1 ring-inset ring-brand-orange-300/50",
    stripe: "bg-brand-orange-700",
  },
  reserved: {
    bg:   "bg-brand-sky-500 text-white border-brand-sky-600 shadow-brand-sky-200",
    dot:  "bg-brand-sky-500",
    pill: "bg-brand-sky-50 text-brand-sky-700 border-brand-sky-200",
    ring: "",
    stripe: "bg-brand-sky-700",
  },
  cleaningPending: {
    bg:   "bg-teal-500 text-white border-teal-600 shadow-teal-200",
    dot:  "bg-teal-500",
    pill: "bg-teal-50 text-teal-700 border-teal-200",
    ring: "",
    stripe: "bg-teal-700",
  },
  maintenance: {
    bg:   "bg-rose-500 text-white border-rose-600 shadow-rose-200",
    dot:  "bg-rose-500",
    pill: "bg-rose-50 text-rose-700 border-rose-200",
    ring: "",
    stripe: "bg-rose-700",
  },
  available: {
    bg:   "bg-emerald-500 text-white border-emerald-600 shadow-emerald-200",
    dot:  "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
    ring: "",
    stripe: "bg-emerald-700",
  },
};

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      ? (locale === "zh" ? "æœªåˆ†å±‚" : "Sans Ã©tage")
      : (locale === "zh" ? `${floor}å±‚` : `Ã‰tage ${floor}`);
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

// â”€â”€ Compute unit snapshot status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // Finance â€” current month
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Receivables
  const receivableMonthStats = useMemo(() => calculateReceivableSummary(receivables, { currentMonth: true }), [receivables]);

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
    <div className="-my-6 bg-[#f5f7fb]">
      <div className="mx-auto flex max-w-[1360px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">

        {/* â”€â”€ Building selector â€” segmented control â”€â”€ */}
        <div>
          <div className="inline-flex flex-wrap gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
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

        {/* â”€â”€ Section 1: Core KPI Summary â”€â”€ */}
        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.72fr)]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-natural">
            <div className="mb-3 flex items-center justify-between gap-3">
              <SectionLabel compact>{t.sections.financeOverview}</SectionLabel>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                {monthPrefix}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
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
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-natural">
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
            <p className="mt-1 text-xs text-slate-500">
              {locale === "zh" ? "æŒ‰æ¥¼å±‚æŸ¥çœ‹æˆ¿é—´çŠ¶æ€ï¼Œç‚¹å‡»æˆ¿é—´å¯æ‰“å¼€å¯¹åº”æ¡£æ¡ˆã€‚" : "Statut par etage, cliquez pour ouvrir le dossier."}
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
            const bStates = sortUnits(bUnits).map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks));
            const floorGroups = groupStatesByFloor(bStates, locale);

            const bCounts: Record<string, number> = {};
            for (const s of bStates) bCounts[s.status] = (bCounts[s.status] ?? 0) + 1;

            return (
              <div key={building.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {/* Building header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-brand-orange" />
                    <h4 className="text-sm font-black text-slate-950">{building.display_name}</h4>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {bStates.length} {locale === "zh" ? "é—´" : "unitÃ©s"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                    {(Object.keys(t.statuses) as MgmtStatus[]).filter(s => (bCounts[s] ?? 0) > 0).map(s => (
                      <span key={s} className="flex items-center gap-1.5 text-slate-500">
                        <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_CELL[s].dot)} />
                        {t.statuses[s]}
                        <span className="tabular-nums text-slate-400">{(bCounts[s] ?? 0)}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Floor groups */}
                <div className="bg-slate-50/60 px-4 py-4">
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                    {floorGroups.map(group => (
                      <div key={group.key} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-[11px] font-bold text-slate-500">{group.label}</p>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
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

        {/* â”€â”€ Quick links â”€â”€ */}
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

// â”€â”€ Sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ROOM_CARD: Record<MgmtStatus, { card: string; badge: string; dot: string; action: string }> = {
  sold: {
    card: "border-slate-300 bg-slate-700 text-white",
    badge: "bg-white text-slate-800",
    dot: "bg-slate-300",
    action: "bg-white/15 text-white ring-white/20",
  },
  leased: {
    card: "border-indigo-300 bg-indigo-600 text-white",
    badge: "bg-white text-indigo-700",
    dot: "bg-indigo-200",
    action: "bg-white/15 text-white ring-white/20",
  },
  dailyOccupied: {
    card: "border-brand-orange-300 bg-brand-orange-500 text-white",
    badge: "bg-white text-brand-orange-700",
    dot: "bg-brand-orange-200",
    action: "bg-white/15 text-white ring-white/20",
  },
  reserved: {
    card: "border-brand-sky-300 bg-brand-sky-500 text-white",
    badge: "bg-white text-brand-sky-700",
    dot: "bg-brand-sky-200",
    action: "bg-white/15 text-white ring-white/20",
  },
  cleaningPending: {
    card: "border-cyan-300 bg-cyan-500 text-white",
    badge: "bg-white text-cyan-700",
    dot: "bg-cyan-200",
    action: "bg-white/15 text-white ring-white/20",
  },
  maintenance: {
    card: "border-rose-300 bg-rose-500 text-white",
    badge: "bg-white text-rose-700",
    dot: "bg-rose-200",
    action: "bg-white/15 text-white ring-white/20",
  },
  available: {
    card: "border-emerald-200 bg-emerald-50 text-emerald-900",
    badge: "bg-emerald-600 text-white",
    dot: "bg-emerald-500",
    action: "bg-white/80 text-emerald-700 ring-emerald-200",
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
  const roomText = locale === "zh" ? "æˆ¿é—´æ¡£æ¡ˆ" : "Dossier";

  return (
    <Link
      href={href}
      title={`${state.unit.unit_no} - ${statusLabel}`}
      aria-label={`${state.unit.unit_no} - ${statusLabel}`}
      className={cn(
        "group relative flex min-h-[92px] flex-col justify-between overflow-hidden rounded-2xl border p-3 shadow-sm",
        "transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lifted active:scale-[0.98]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
        styles.card,
      )}
    >
      <span className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(135deg,rgba(255,255,255,0.16),transparent_55%)] opacity-70" />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <span className={cn("rounded-full px-2.5 py-1 font-mono text-xs font-black shadow-sm", styles.badge)}>
          {state.unit.unit_no}
        </span>
        <span className={cn("mt-1 h-2 w-2 rounded-full", styles.dot)} />
      </div>
      <div className="relative z-10">
        <p className="truncate text-[11px] font-bold">{statusLabel}</p>
        <p className={cn("mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset", styles.action)}>
          {roomText}
        </p>
      </div>
    </Link>
  );
}

function StatusSummaryCard({ label, value, status }: { label: string; value: number; status: MgmtStatus }) {
  const styles = ROOM_CARD[status];
  return (
    <div className={cn("min-h-[86px] rounded-2xl border px-3 py-3", styles.card)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold opacity-90">{label}</span>
        <span className={cn("h-2 w-2 rounded-full", styles.dot)} />
      </div>
      <p className="mt-2 text-2xl font-black tabular-nums">{value}</p>
    </div>
  );
}

function SectionLabel({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <h2 className={cn(
      "text-[11px] font-black uppercase tracking-[0.14em] text-slate-500",
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
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
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
    warning:  { bg: "bg-white border-slate-200", text: "text-brand-amber-700", dot: "bg-brand-amber-500" },
    danger:   { bg: "bg-white border-slate-200", text: "text-brand-red-700", dot: "bg-brand-red-500" },
  };
  const s = styles[variant];
  return (
    <div className={cn("flex min-h-[86px] overflow-hidden rounded-2xl border bg-white shadow-sm", s.bg)}>
      <div className="flex min-w-0 flex-1 flex-col justify-between px-4 py-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
        </div>
        <p className={cn("truncate text-[22px] font-black tracking-tight tabular-nums", s.text)}>
          {value}
        </p>
      </div>
    </div>
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
        : "border-slate-200 bg-white",
    )}>
      <div className="mb-1.5 flex items-center gap-2">
        {active && <AlertTriangle className="h-4 w-4 text-brand-red-500 shrink-0" />}
        <span className={cn(
          "text-[11px] font-medium uppercase tracking-[0.14em]",
          active ? "text-brand-red-600" : "text-slate-400",
        )}>
          {label}
        </span>
      </div>
      <p className={cn(
        compact ? "text-lg font-black tabular-nums" : "text-xl font-black tabular-nums",
        active ? "text-brand-red-700" : "text-slate-400",
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
