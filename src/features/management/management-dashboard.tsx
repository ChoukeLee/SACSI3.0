"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Info,
  ReceiptText,
} from "lucide-react";
import {
  calculateReceivableSummary,
} from "@/features/finance/receivable-summary";
import { getDailyRoomStateForDate } from "@/features/daily-rentals/room-status";
import { roomStatusStyles } from "@/lib/status-styles";
import { RoomCard } from "@/components/room-card";
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
  booking?: DailyBookingRow | null;
  lease?: LeaseContractRow | null;
  sale?: SaleContractRow | null;
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
    bg:   "bg-[#505080] text-white border-[#505080]/25",
    dot:  "bg-[#505080]",
    pill: "bg-[#505080]/10 text-[#505080] border-[#505080]/20",
    ring: "",
    stripe: "bg-[#505080]",
  },
  leased: {
    bg:   "bg-[#7050A0] text-white border-[#7050A0]/20",
    dot:  "bg-[#7050A0]",
    pill: "bg-[#7050A0]/10 text-[#5C4388] border-[#7050A0]/20",
    ring: "",
    stripe: "bg-[#7050A0]",
  },
  dailyOccupied: {
    bg:   "bg-[#5090C0] text-white border-[#5090C0]/20",
    dot:  "bg-[#5090C0]",
    pill: "bg-[#5090C0]/10 text-[#376F99] border-[#5090C0]/20",
    ring: "ring-1 ring-inset ring-[#5090C0]/30",
    stripe: "bg-[#5090C0]",
  },
  reserved: {
    bg:   "bg-[#A0C0E0] text-[#1F4564] border-[#A0C0E0]/30",
    dot:  "bg-[#A0C0E0]",
    pill: "bg-[#A0C0E0]/25 text-[#315E83] border-[#A0C0E0]/30",
    ring: "",
    stripe: "bg-[#A0C0E0]",
  },
  cleaningPending: {
    bg:   "bg-[#5AB5B8] text-white border-[#5AB5B8]/25",
    dot:  "bg-[#5AB5B8]",
    pill: "bg-[#5AB5B8]/10 text-[#32757A] border-[#5AB5B8]/25",
    ring: "",
    stripe: "bg-[#5AB5B8]",
  },
  maintenance: {
    bg:   "bg-[#F0A080] text-[#673522] border-[#F0A080]/35",
    dot:  "bg-[#F0A080]",
    pill: "bg-[#F0A080]/20 text-[#8A4A32] border-[#F0A080]/35",
    ring: "",
    stripe: "bg-[#F0A080]",
  },
  available: {
    bg:   "bg-[#F0E0D0] text-[#4F4238] border-[#F0E0D0]/70",
    dot:  "bg-[#F0E0D0]",
    pill: "bg-[#F0E0D0]/55 text-[#5D4B3F] border-[#F0E0D0]",
    ring: "",
    stripe: "bg-[#F0E0D0]",
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
  const activeSale = saleContracts.find(s => s.unit_id === unit.id && s.status === "active") ?? null;
  if (unit.status === "sold" || activeSale) return { unit, status: "sold", sale: activeSale };

  const activeLease = leaseContracts.find(l => l.unit_id === unit.id && l.status === "active") ?? null;
  if (unit.status === "leased" || activeLease) return { unit, status: "leased", lease: activeLease };

  const dailyState = getDailyRoomStateForDate({ unit, dateStr, bookings: dailyBookings, cleaningTasks });
  if (dailyState.status === "occupied" || dailyState.status === "checking_out_today") return { unit, status: "dailyOccupied", booking: dailyState.booking };
  if (dailyState.status === "reserved") return { unit, status: "reserved", booking: dailyState.booking };
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

  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

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
    <div className="flex flex-col gap-6">

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
            <div className="mt-3">
              <RoomMixRadar counts={counts} labels={t.statuses} />
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
                <div className="bg-[#F8F6F3] px-4 py-4">
                  <div className="grid grid-cols-1 gap-3">
                    {floorGroups.map(group => (
                      <div key={group.key} className="rounded-[18px] border border-brand-warm-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-xs font-bold text-brand-ink-500">{group.label}</p>
                          <span className="rounded-full bg-brand-warm-100 px-2 py-0.5 text-xs font-bold text-brand-ink-500">
                            {group.states.length}
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-start gap-2.5">
                          {group.states.map(s => (
                            <RoomCard
                              key={s.unit.id}
                              variant="matrix"
                              roomNo={s.unit.unit_no ?? "?"}
                              status={s.status}
                              statusLabel={t.statuses[s.status]}
                              customerName={getStateCustomerName(s, customerNameById, locale)}
                              dateText={getStateDateText(s, locale)}
                              href={routeFor(locale, `/units/${s.unit.id}`)}
                            />
                          ))}
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
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function getStateCustomerName(state: UnitState, customerNameById: Map<string, string>, locale: Locale): string {
  const customerId = state.booking?.customer_id ?? state.lease?.customer_id ?? state.sale?.customer_id ?? null;
  if (customerId && customerNameById.has(customerId)) return customerNameById.get(customerId)!;

  if (state.status === "available") return locale === "zh" ? "可安排入住" : "Disponible";
  if (state.status === "cleaningPending") return locale === "zh" ? "等待保洁" : "Menage";
  if (state.status === "maintenance") return locale === "zh" ? "暂停使用" : "Bloque";
  if (state.status === "sold") return locale === "zh" ? "已售房源" : "Vendu";
  if (state.status === "leased") return locale === "zh" ? "长租客户" : "Locataire";
  return locale === "zh" ? "日租客户" : "Client";
}

function getStateDateText(state: UnitState, locale: Locale): string {
  if (state.booking) {
    const start = shortDate(state.booking.check_in);
    const end = state.booking.checkout_mode === "open"
      ? (state.booking.actual_check_out ? shortDate(state.booking.actual_check_out) : (locale === "zh" ? "未定" : "Open"))
      : (state.booking.check_out ? shortDate(state.booking.check_out) : start);
    return `${start} - ${end}`;
  }
  if (state.lease) return `${locale === "zh" ? "至" : "to"} ${shortDate(state.lease.expected_end_date)}`;
  if (state.sale) return locale === "zh" ? "已完成出售" : "Sold";
  if (state.status === "available") return locale === "zh" ? "公寓" : "Appartement";
  if (state.status === "cleaningPending") return locale === "zh" ? "清洁后可用" : "Disponible apres menage";
  if (state.status === "maintenance") return locale === "zh" ? "需处理" : "Action requise";
  return "";
}

function shortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "--";
  const [, month, day] = dateStr.split("-");
  return month && day ? `${month}/${day}` : dateStr;
}

function RoomMixRadar({
  counts,
  labels,
}: {
  counts: Record<MgmtStatus, number>;
  labels: Record<MgmtStatus, string>;
}) {
  const statuses: MgmtStatus[] = ["sold", "leased", "dailyOccupied", "reserved", "cleaningPending", "available"];
  const fills: Record<MgmtStatus, string> = {
    sold: "#505080",
    leased: "#7050A0",
    dailyOccupied: "#5090C0",
    reserved: "#A0C0E0",
    cleaningPending: "#5AB5B8",
    maintenance: "#F0A080",
    available: "#F0E0D0",
  };
  const max = Math.max(...statuses.map(s => counts[s]), 1);
  const center = 72;
  const radius = 54;
  const points = statuses.map((status, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / statuses.length;
    const ratio = Math.max(0.18, counts[status] / max);
    return [
      center + Math.cos(angle) * radius * ratio,
      center + Math.sin(angle) * radius * ratio,
    ];
  }).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return (
    <div className="rounded-2xl border border-[#A0C0E0]/25 bg-[#F8FBFD] p-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-black text-brand-ink-700">Room mix</p>
        <span className="text-xs font-bold tabular-nums text-brand-ink-400">
          {statuses.reduce((sum, status) => sum + counts[status], 0)}
        </span>
      </div>
      <svg viewBox="0 0 144 144" className="mx-auto h-32 w-32" aria-hidden="true">
        {[0.33, 0.66, 1].map(scale => (
          <polygon
            key={scale}
            points={statuses.map((_, index) => {
              const angle = -Math.PI / 2 + (index * Math.PI * 2) / statuses.length;
              return `${(center + Math.cos(angle) * radius * scale).toFixed(1)},${(center + Math.sin(angle) * radius * scale).toFixed(1)}`;
            }).join(" ")}
            fill="none"
            stroke="#D7E3EE"
            strokeWidth="1"
          />
        ))}
        <polygon points={points} fill="#A0C0E0" fillOpacity="0.42" stroke="#5090C0" strokeWidth="2" />
        {statuses.map((status, index) => {
          const angle = -Math.PI / 2 + (index * Math.PI * 2) / statuses.length;
          const x = center + Math.cos(angle) * (radius + 10);
          const y = center + Math.sin(angle) * (radius + 10);
          return (
            <circle key={status} cx={x} cy={y} r="3" fill={fills[status]} />
          );
        })}
      </svg>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-semibold text-brand-ink-500">
        {statuses.slice(0, 4).map(status => (
          <span key={status} className="truncate">
            {labels[status]} <span className="tabular-nums text-brand-ink-400">{counts[status]}</span>
          </span>
        ))}
      </div>
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
    neutral:  { bg: "bg-white border-[#A0C0E0]/35", text: "text-[#303052]", dot: "bg-[#A0C0E0]", bar: "bg-[#A0C0E0]" },
    positive: { bg: "bg-white border-[#5AB5B8]/30", text: "text-[#32757A]", dot: "bg-[#5AB5B8]", bar: "bg-[#5AB5B8]" },
    warning:  { bg: "bg-white border-[#7050A0]/25", text: "text-[#5C4388]", dot: "bg-[#7050A0]", bar: "bg-[#7050A0]" },
    danger:   { bg: "bg-white border-[#F0A080]/35", text: "text-[#8A4A32]", dot: "bg-[#F0A080]", bar: "bg-[#F0A080]" },
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
