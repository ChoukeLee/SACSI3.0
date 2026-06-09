"use client";

import { useState, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { getDailyRoomStateForDate } from "@/features/daily-rentals/room-status";
import { calculateReceivableSummary } from "@/features/finance/receivable-summary";
import { FinanceDetailPanel } from "@/features/management/finance-detail-panel";
import { RoomCard } from "@/components/room-card";
import { RoomBoard } from "@/components/room-board";
import { RoomLegend } from "@/components/room-legend";
import { getRoomCardActions } from "@/lib/room-card-actions";
import type { Locale, ManagementDict } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { formatXof, cn, sortUnits } from "@/lib/utils";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, CustomerRow,
  ReceivableRow, PaymentRow,
} from "@/types/database";

export type MgmtStatus =
  | "sold" | "leased" | "dailyOccupied" | "reserved"
  | "cleaningPending" | "maintenance" | "available";

interface UnitState {
  unit: UnitRow; status: MgmtStatus;
  booking?: DailyBookingRow | null; lease?: LeaseContractRow | null; sale?: SaleContractRow | null;
}
interface FloorGroup { key: string; label: string; sortValue: number; states: UnitState[] }

export const STATUS_DOT: Record<MgmtStatus, string> = {
  sold: "#B88A48", leased: "#5E9BC5", dailyOccupied: "#62B6F5",
  reserved: "#E8C840", cleaningPending: "#5CC4B8", maintenance: "#F08090",
  available: "#A0D0E8",
};

function firstNumber(v: string | null | undefined): number | null {
  const m = String(v ?? "").match(/\d+/); return m ? Number(m[0]) : null;
}
function getUnitFloorValue(u: UnitRow): number | null {
  const f = firstNumber(u.floor_label); if (f !== null) return f;
  const n = firstNumber(u.unit_no); if (n === null) return null;
  return n >= 100 ? Math.floor(n / 100) : n;
}
function groupStatesByFloor(states: UnitState[], locale: Locale): FloorGroup[] {
  const groups = new Map<string, FloorGroup>();
  for (const s of states) {
    const floor = getUnitFloorValue(s.unit);
    const key = floor === null ? "__unknown__" : String(floor);
    const label = floor === null
      ? (locale === "zh" ? "未分层" : "Sans étage")
      : (locale === "zh" ? `${floor}层` : `Étage ${floor}`);
    if (!groups.has(key)) groups.set(key, { key, label, sortValue: floor ?? Number.MAX_SAFE_INTEGER, states: [] });
    groups.get(key)!.states.push(s);
  }
  return [...groups.values()]
    .map(g => ({ ...g, states: sortUnits(g.states.map(s => s.unit)).map(u => g.states.find(s => s.unit.id === u.id)!).filter(Boolean) }))
    .sort((a, b) => a.sortValue - b.sortValue);
}
function computeUnitState(
  u: UnitRow, dailyBookings: DailyBookingRow[], leaseContracts: LeaseContractRow[],
  saleContracts: SaleContractRow[], cleaningTasks: { unit_id: string; is_completed: boolean }[],
  dateStr: string,
): UnitState {
  const activeSale = saleContracts.find(s => s.unit_id === u.id && s.status === "active") ?? null;
  if (u.status === "sold" || activeSale) return { unit: u, status: "sold", sale: activeSale };
  const activeLease = leaseContracts.find(l => l.unit_id === u.id && l.status === "active") ?? null;
  if (u.status === "leased" || activeLease) return { unit: u, status: "leased", lease: activeLease };
  const ds = getDailyRoomStateForDate({ unit: u, dateStr, bookings: dailyBookings, cleaningTasks });
  if (ds.status === "occupied" || ds.status === "checking_out_today") return { unit: u, status: "dailyOccupied", booking: ds.booking };
  if (ds.status === "reserved") return { unit: u, status: "reserved", booking: ds.booking };
  if (ds.status === "cleaning") return { unit: u, status: "cleaningPending" };
  if (ds.status === "maintenance" || ds.status === "locked") return { unit: u, status: "maintenance" };
  return { unit: u, status: "available" };
}
function shortDate(d: string | null | undefined): string {
  if (!d) return "--"; const [, m, day] = d.split("-"); return m && day ? `${m}/${day}` : d;
}
function stateCustomerName(s: UnitState, cmap: Map<string, string>, locale: Locale): string {
  const cid = s.booking?.customer_id ?? s.lease?.customer_id ?? s.sale?.customer_id ?? null;
  if (cid && cmap.has(cid)) return cmap.get(cid)!;
  if (s.status === "available") return locale === "zh" ? "空闲" : "Libre";
  if (s.status === "cleaningPending") return locale === "zh" ? "待洁" : "Ménage";
  if (s.status === "maintenance") return locale === "zh" ? "维修" : "Bloqué";
  return "";
}
function stateDateText(s: UnitState, locale: Locale): string {
  if (s.booking) {
    const st = shortDate(s.booking.check_in);
    const end = s.booking.checkout_mode === "open"
      ? (s.booking.actual_check_out ? shortDate(s.booking.actual_check_out) : (locale === "zh" ? "未定" : "Open"))
      : (s.booking.check_out ? shortDate(s.booking.check_out) : st);
    return `${st} - ${end}`;
  }
  if (s.lease) return `${locale === "zh" ? "至" : "to"} ${shortDate(s.lease.expected_end_date)}`;
  return "";
}

// ════════════════════════════════════════════════════════════
// Finance section client
// ════════════════════════════════════════════════════════════

export function FinanceSectionClient({
  receivables, payments, units, buildings, customers, locale, t,
}: {
  receivables: ReceivableRow[]; payments: PaymentRow[];
  units: UnitRow[]; buildings: BuildingRow[]; customers: CustomerRow[];
  locale: Locale; t: ManagementDict;
}) {
  const [detail, setDetail] = useState<string | null>(null);

  const nonDaily = useMemo(() => receivables.filter(r => r.source_type !== "daily_booking"), [receivables]);
  const stats = useMemo(() => calculateReceivableSummary(nonDaily, { currentMonth: true }), [nonDaily]);

  const colorMap: Record<string, string> = {
    accentBlue: "before:bg-accentBlue-500",
    accentGreen: "before:bg-accentGreen-500",
    accentAmber: "before:bg-accentAmber-500",
    accentRed: "before:bg-accentRed-500",
  };
  const iconBg: Record<string, string> = {
    accentBlue: "bg-accentBlue-50 text-accentBlue-600",
    accentGreen: "bg-accentGreen-50 text-accentGreen-600",
    accentAmber: "bg-accentAmber-50 text-accentAmber-600",
    accentRed: "bg-accentRed-50 text-accentRed-600",
  };

  const blocks = [
    { key: "receivable", label: t.cockpit.receivableThisMonth, value: stats.totalReceivable, color: "accentBlue" as const },
    { key: "collected", label: t.cockpit.paidThisMonth, value: stats.totalPaid, color: "accentGreen" as const },
    { key: "outstanding", label: t.cockpit.outstandingThisMonth, value: stats.outstanding, color: "accentAmber" as const },
    { key: "overdue", label: t.cockpit.overdueThisMonth, value: stats.overdue, color: "accentRed" as const },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {blocks.map(block => {
          const filled = block.key === detail;
          return (
            <button
              key={block.key}
              onClick={() => setDetail(filled ? null : block.key)}
              className={`group relative flex items-center gap-3 overflow-hidden rounded-xl border border-border/60 bg-card px-4 py-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-border before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full ${colorMap[block.color]}`}
            >
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg[block.color]}`}>
                <span className="text-sm font-bold">{block.key[0].toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">{block.label}</p>
                <p className="text-lg font-bold tracking-tight tabular-nums">{formatXof(block.value)}</p>
              </div>
            </button>
          );
        })}
      </div>
      {detail != null && (
        <FinanceDetailPanel
          open={detail as "receivable" | "collected" | "outstanding" | "overdue"}
          onClose={() => setDetail(null)}
          receivables={receivables}
          payments={payments}
          units={units}
          buildings={buildings}
          customers={customers}
          locale={locale}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════
// Unit data section client — building filter + status + room board
// ════════════════════════════════════════════════════════════

export function UnitDataClient({
  buildings, units, dailyBookings, leaseContracts, saleContracts,
  saleSchedules, cleaningTasks, customers, locale, t,
}: {
  buildings: BuildingRow[]; units: UnitRow[]; dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[]; saleContracts: SaleContractRow[];
  saleSchedules: SalePaymentScheduleRow[]; cleaningTasks: { unit_id: string; is_completed: boolean }[];
  customers: CustomerRow[]; locale: Locale; t: ManagementDict;
}) {
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>("__all__");

  const residentialUnits = useMemo(() => units.filter(u => u.kind === "apartment"), [units]);
  const activeBuildings = useMemo(() => buildings.filter(b => b.is_active), [buildings]);
  const filteredUnits = useMemo(() => {
    if (selectedBuildingId === "__all__") return residentialUnits;
    return residentialUnits.filter(u => u.building_id === selectedBuildingId);
  }, [residentialUnits, selectedBuildingId]);
  const buildingUnits = useMemo(() => {
    const m = new Map<string, UnitRow[]>();
    for (const b of activeBuildings) m.set(b.id, residentialUnits.filter(u => u.building_id === b.id));
    return m;
  }, [activeBuildings, residentialUnits]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const unitStates = useMemo(
    () => filteredUnits.map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks, todayStr)),
    [filteredUnits, dailyBookings, leaseContracts, saleContracts, cleaningTasks, todayStr],
  );
  const counts = useMemo(() => {
    const c: Record<MgmtStatus, number> = { sold: 0, leased: 0, dailyOccupied: 0, reserved: 0, cleaningPending: 0, maintenance: 0, available: 0 };
    for (const s of unitStates) c[s.status]++; return c;
  }, [unitStates]);

  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const risks = useMemo(() => {
    const cleaning = unitStates.filter(s => s.status === "cleaningPending").length;
    const maintenance = unitStates.filter(s => s.status === "maintenance").length;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 30); const cutoffStr = cutoff.toISOString().slice(0, 10);
    const todayStr2 = new Date().toISOString().slice(0, 10);
    const leaseExpiring = leaseContracts.filter(l => l.status === "active" && l.expected_end_date >= todayStr2 && l.expected_end_date <= cutoffStr);
    const activeSales = saleContracts.filter(s => s.status === "active");
    const saleWithPending = activeSales.filter(s => saleSchedules.some(sch => sch.sale_contract_id === s.id && sch.status !== "paid"));
    return { cleaning, maintenance, leaseExpiring, saleWithPending };
  }, [unitStates, leaseContracts, saleContracts, saleSchedules]);

  const totalRooms = filteredUnits.length;
  const occupiedPct = totalRooms > 0 ? Math.round((counts.dailyOccupied + counts.leased + counts.sold) / totalRooms * 100) : 0;

  return (
    <>
      {/* Building selector */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {locale === "zh" ? "楼栋" : "Bâtiment"}
        </span>
        <div className="inline-flex gap-0.5 rounded-lg border border-border/60 bg-muted/50 p-1">
          {[{ id: "__all__", display_name: t.allBuildings }, ...activeBuildings].map(b => (
            <button
              key={b.id}
              onClick={() => setSelectedBuildingId(b.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition",
                selectedBuildingId === b.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {b.display_name}
            </button>
          ))}
        </div>
      </div>

      {/* Status overview bar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-card px-4 py-3">
        <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t.sections.buildingStatus}
        </span>
        {(["dailyOccupied", "reserved", "leased", "sold", "cleaningPending", "maintenance", "available"] as MgmtStatus[]).map(s => (
          <div key={s} className="flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs font-medium">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT[s] }} />
            <span className="tabular-nums font-semibold">{counts[s]}</span>
            <span className="text-muted-foreground">{t.statuses[s]}</span>
          </div>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {locale === "zh" ? "入住率" : "Taux occ."} <span className="font-semibold text-foreground tabular-nums">{occupiedPct}%</span>
        </span>
      </div>

      {/* Risk alerts */}
      {(risks.cleaning > 0 || risks.maintenance > 0 || risks.leaseExpiring.length > 0 || risks.saleWithPending.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accentRed-100 bg-accentRed-50/60 px-4 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 text-accentRed-500 shrink-0" />
          <span className="text-xs font-semibold text-accentRed-700">{locale === "zh" ? "待处理" : "Attention"}:</span>
          {risks.cleaning > 0 && <span className="text-xs text-accentRed-600">{risks.cleaning} {locale === "zh" ? "间待保洁" : "ménages"}</span>}
          {risks.maintenance > 0 && <span className="text-xs text-accentRed-600">{risks.maintenance} {locale === "zh" ? "间维修" : "maintenance"}</span>}
          {risks.leaseExpiring.length > 0 && <span className="text-xs text-accentRed-600">{risks.leaseExpiring.length} {locale === "zh" ? "份合同将到期" : "baux expirant"}</span>}
          {risks.saleWithPending.length > 0 && <span className="text-xs text-accentRed-600">{risks.saleWithPending.length} {locale === "zh" ? "笔出售待回款" : "ventes en attente"}</span>}
        </div>
      )}

      {/* Room board */}
      {(selectedBuildingId === "__all__" ? activeBuildings : activeBuildings.filter(b => b.id === selectedBuildingId)).map(building => {
        const bUnits = buildingUnits.get(building.id) ?? [];
        const bStates = sortUnits(bUnits).map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks, todayStr));
        const floorGroups = groupStatesByFloor(bStates, locale);
        const bOccupied = bStates.filter(s => s.status === "dailyOccupied" || s.status === "leased" || s.status === "sold").length;
        const bTotal = bStates.length;

        return (
          <RoomBoard
            key={building.id}
            header={<>
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                <h3 className="text-sm font-semibold">{building.display_name}</h3>
                <span className="text-[12px] font-medium text-[#5D7186] tabular-nums">
                  {bOccupied}/{bTotal} {locale === "zh" ? "间已占用" : "occupés"}
                </span>
              </div>
              <RoomLegend items={(["dailyOccupied", "reserved", "leased", "sold", "cleaningPending", "maintenance", "available"] as MgmtStatus[]).map(s => ({ key: s, label: t.statuses[s], color: STATUS_DOT[s] }))} />
            </>}
          >
            {floorGroups.map(group => (
              <div key={group.key} className={group.key !== floorGroups[0]?.key ? "mt-[18px]" : ""}>
                <p className="mb-2 text-[12px] font-semibold text-[#5D7186]">{group.label} <span className="font-normal text-[#5D7186]/60">{group.states.length}</span></p>
                <div className="grid grid-cols-6 gap-3.5">
                  {group.states.map(s => {
                    const detailHref = routeFor(locale, `/units/${s.unit.id}`);
                    const actions = getRoomCardActions(s.status, {
                      locale, unitId: s.unit.id, unitNo: s.unit.unit_no ?? undefined,
                      detailHref,
                      dailyHref: routeFor(locale, "/daily-rentals"),
                      leaseHref: routeFor(locale, "/leases"),
                      saleHref: routeFor(locale, "/sales"),
                    });
                    return (
                      <RoomCard
                        key={s.unit.id}
                        roomNo={s.unit.unit_no ?? "?"}
                        status={s.status}
                        customerName={stateCustomerName(s, customerNameById, locale)}
                        dateText={stateDateText(s, locale)}
                        href={detailHref}
                        actions={actions}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </RoomBoard>
        );
      })}
    </>
  );
}
