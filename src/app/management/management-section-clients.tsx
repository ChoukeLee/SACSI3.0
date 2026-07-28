"use client";

import { useEffect, useState, useMemo } from "react";
import { AlertTriangle, Banknote, Clock3, TrendingUp, WalletCards } from "lucide-react";
import { getDailyRoomStateForDate } from "@/features/daily-rentals/room-status";
import { calculateReceivableSummary } from "@/features/finance/receivable-summary";
import { FinanceDetailPanel } from "@/features/management/finance-detail-panel";
import { getCurrentMonthNonDailyPayments, sumPayments } from "@/features/management/finance-utils";
import { RoomCard } from "@/components/room-card";
import { RoomBoard } from "@/components/room-board";
import { RoomLegend } from "@/components/room-legend";
import { DataVizCard, DonutChart, RadarChart } from "@/components/ui/data-viz";
import { FilterBar, SegmentedControl, StatTile } from "@/components/ui/operational";
import { getRoomCardActions } from "@/lib/room-card-actions";
import { isOwnerOccupiedUnit } from "@/lib/unit-display";
import { referencedLeaseContractNo, unitCardPartyFromNotes, unresolvedUnitCardParty } from "@/lib/unit-card-party";
import type { Locale, ManagementDict } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { floorSortValue, formatXof, cn, sortUnitsForBuilding } from "@/lib/utils";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, CustomerRow,
  ReceivableRow, PaymentRow,
} from "@/types/database";

export type MgmtStatus =
  | "sold" | "leased" | "dailyOccupied" | "reserved"
  | "cleaningPending" | "maintenance" | "ownerOccupied" | "available";

interface UnitState {
  unit: UnitRow; status: MgmtStatus;
  booking?: DailyBookingRow | null; lease?: LeaseContractRow | null; sale?: SaleContractRow | null;
}
interface FloorGroup { key: string; label: string; sortValue: number; states: UnitState[] }

export const STATUS_DOT: Record<MgmtStatus, string> = {
  sold: "#A0D0E8", leased: "#46515C", dailyOccupied: "#62B6F5",
  reserved: "#E8C840", cleaningPending: "#5CC4B8", maintenance: "#F08090",
  ownerOccupied: "#8F8D89",
  available: "#B88A48",
};
const STATUS_ORDER: MgmtStatus[] = ["dailyOccupied", "reserved", "leased", "sold", "cleaningPending", "maintenance", "ownerOccupied", "available"];

function firstNumber(v: string | null | undefined): number | null {
  const m = String(v ?? "").match(/\d+/); return m ? Number(m[0]) : null;
}
function getUnitFloorValue(u: UnitRow): number | null {
  const rawFloor = String(u.floor_label ?? "").trim();
  if (/^(G|G层|G楼|GF|G\/F|GROUND|GROUND FLOOR|RDC|底层|地面层)$/i.test(rawFloor)) return -1;
  const f = firstNumber(u.floor_label); if (f !== null) return f;
  const n = firstNumber(u.unit_no); if (n === null) return null;
  return n >= 100 ? Math.floor(n / 100) : n;
}
function groupStatesByFloor(states: UnitState[], locale: Locale, buildingCode?: string | null): FloorGroup[] {
  const groups = new Map<string, FloorGroup>();
  for (const s of states) {
    const floor = getUnitFloorValue(s.unit);
    const key = floor === null ? "__unknown__" : String(floor);
    const label = floor === null
      ? (locale === "zh" ? "未分层" : "Sans étage")
      : floor === -1 ? (locale === "zh" ? "G层" : "RDC") : (locale === "zh" ? `${floor}层` : `Étage ${floor}`);
    if (!groups.has(key)) groups.set(key, { key, label, sortValue: floor === null ? Number.MAX_SAFE_INTEGER : floorSortValue(s.unit.floor_label), states: [] });
    groups.get(key)!.states.push(s);
  }
  return [...groups.values()]
    .map(g => ({ ...g, states: sortUnitsForBuilding(g.states.map(s => s.unit), buildingCode).map(u => g.states.find(s => s.unit.id === u.id)!).filter(Boolean) }))
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
  const referencedNo = referencedLeaseContractNo(u.notes);
  const referencedLease = referencedNo ? leaseContracts.find(l => l.contract_no === referencedNo && l.status === "active") ?? null : null;
  if (u.status === "leased" || activeLease || referencedLease) return { unit: u, status: "leased", lease: activeLease ?? referencedLease };
  if (isOwnerOccupiedUnit(u)) return { unit: u, status: "ownerOccupied" };
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
  const noteParty = unitCardPartyFromNotes(s.unit, s.status);
  if (noteParty) return noteParty;
  if (s.status === "leased" || s.status === "sold" || s.status === "dailyOccupied") return unresolvedUnitCardParty(s.status, locale);
  if (s.status === "ownerOccupied") return s.unit.layout || (locale === "zh" ? "科建集团办公室" : "Bureau Kejian Group");
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
  const monthPrefix = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const currentMonthPayments = useMemo(() => getCurrentMonthNonDailyPayments(payments, monthPrefix), [payments, monthPrefix]);
  const currentMonthCollected = useMemo(() => sumPayments(currentMonthPayments), [currentMonthPayments]);
  const currentMonthOutstanding = Math.max(stats.totalReceivable - currentMonthCollected, 0);

  const blocks = [
    { key: "receivable", label: t.cockpit.receivableThisMonth, value: stats.totalReceivable, color: "accentBlue" as const, icon: TrendingUp },
    { key: "collected", label: t.cockpit.paidThisMonth, value: currentMonthCollected, color: "accentGreen" as const, icon: Banknote },
    { key: "outstanding", label: t.cockpit.outstandingThisMonth, value: currentMonthOutstanding, color: "accentAmber" as const, icon: WalletCards },
    { key: "overdue", label: t.cockpit.overdueThisMonth, value: stats.overdue, color: "accentRed" as const, icon: Clock3 },
  ];

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-3 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{locale === "zh" ? "财务概览" : "Vue financiere"}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{locale === "zh" ? "点击指标查看明细" : "Cliquez un indicateur pour le detail"}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {blocks.map(block => {
            const filled = block.key === detail;
            return (
              <StatTile
                key={block.key}
                onClick={() => setDetail(filled ? null : block.key)}
                active={filled}
                icon={block.icon}
                tone={block.color === "accentGreen" ? "green" : block.color === "accentAmber" ? "amber" : block.color === "accentRed" ? "red" : "blue"}
                label={block.label}
                value={formatXof(block.value)}
              />
            );
          })}
        </div>
      </div>
      <DataVizCard
        title={locale === "zh" ? "本月回款结构" : "Structure mensuelle"}
        description={locale === "zh" ? "已收、未收与逾期拆分" : "Payé, restant et en retard"}
        metric={`${Math.round(stats.collectionRate * 100)}%`}
      >
        <DonutChart
          centerValue={`${Math.round(stats.collectionRate * 100)}%`}
          centerLabel={locale === "zh" ? "回款率" : "Taux"}
          items={[
            { label: t.cockpit.paidThisMonth, value: currentMonthCollected, tone: "green" },
            { label: t.cockpit.outstandingThisMonth, value: Math.max(currentMonthOutstanding - stats.overdue, 0), tone: "amber" },
            { label: t.cockpit.overdueThisMonth, value: stats.overdue, tone: "red" },
          ]}
        />
      </DataVizCard>
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
  const residentialUnits = useMemo(() => units.filter(u => u.kind === "apartment" || isOwnerOccupiedUnit(u)), [units]);
  const activeBuildings = useMemo(() => buildings.filter(b => b.is_active), [buildings]);
  const firstBuildingId = activeBuildings[0]?.id ?? "";
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>(firstBuildingId);
  const [selectedStatus, setSelectedStatus] = useState<MgmtStatus | null>(null);

  useEffect(() => {
    if (activeBuildings.length === 0) {
      setSelectedBuildingId("");
      return;
    }
    if (!activeBuildings.some((building) => building.id === selectedBuildingId)) {
      setSelectedBuildingId(activeBuildings[0].id);
    }
  }, [activeBuildings, selectedBuildingId]);

  const filteredUnits = useMemo(() => {
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
    const c: Record<MgmtStatus, number> = { sold: 0, leased: 0, dailyOccupied: 0, reserved: 0, cleaningPending: 0, maintenance: 0, ownerOccupied: 0, available: 0 };
    for (const s of unitStates) c[s.status]++; return c;
  }, [unitStates]);
  const visibleStatuses = useMemo(() => STATUS_ORDER.filter(status => counts[status] > 0), [counts]);

  useEffect(() => {
    if (selectedStatus && counts[selectedStatus] === 0) setSelectedStatus(null);
  }, [counts, selectedStatus]);

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
  const occupiedPct = totalRooms > 0 ? Math.round((counts.dailyOccupied + counts.leased + counts.sold + counts.ownerOccupied) / totalRooms * 100) : 0;
  const riskMax = Math.max(1, totalRooms, risks.leaseExpiring.length, risks.saleWithPending.length);

  return (
    <>
      <FilterBar
        meta={
          <span>
            {locale === "zh" ? "入住率" : "Taux occ."} <span className="font-semibold text-foreground">{occupiedPct}%</span>
          </span>
        }
      >
        <span className="text-xs font-semibold text-muted-foreground">
          {locale === "zh" ? "楼栋" : "Bâtiment"}
        </span>
        <SegmentedControl
          value={selectedBuildingId}
          onChange={setSelectedBuildingId}
          ariaLabel={locale === "zh" ? "楼栋筛选" : "Filtre bâtiment"}
          items={activeBuildings.map((b) => ({
            value: b.id,
            label: b.display_name,
          }))}
        />
        <div className="basis-full pt-1">
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
            <span className="mr-2 text-xs font-medium text-muted-foreground">
              {t.sections.buildingStatus}
            </span>
          {visibleStatuses.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSelectedStatus(current => current === s ? null : s)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition",
                selectedStatus === s
                  ? "border-foreground/20 bg-foreground text-background shadow-sm"
                  : "border-border bg-muted/50 hover:bg-muted",
              )}
              aria-pressed={selectedStatus === s}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STATUS_DOT[s] }} />
              <span className="tabular-nums font-semibold">{counts[s]}</span>
              <span className={selectedStatus === s ? "text-background/80" : "text-muted-foreground"}>{s === "ownerOccupied" ? (locale === "zh" ? "自用" : "Usage interne") : t.statuses[s]}</span>
            </button>
          ))}
          {selectedStatus && (
            <button
              type="button"
              onClick={() => setSelectedStatus(null)}
              className="rounded-full px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {locale === "zh" ? "显示全部" : "Tout afficher"}
            </button>
          )}
          </div>
        </div>
      </FilterBar>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <DataVizCard
          title={locale === "zh" ? "房态结构" : "Structure des chambres"}
          description={locale === "zh" ? "保留现有房态颜色，只统一呈现方式" : "Couleurs métier conservées"}
          metric={`${totalRooms} ${locale === "zh" ? "间" : "unités"}`}
        >
          <DonutChart
            centerValue={`${occupiedPct}%`}
            centerLabel={locale === "zh" ? "占用" : "Occupé"}
            items={visibleStatuses.map((status) => ({
              label: status === "ownerOccupied" ? (locale === "zh" ? "自用" : "Usage interne") : t.statuses[status],
              value: counts[status],
              color: STATUS_DOT[status],
            }))}
          />
        </DataVizCard>
        <DataVizCard
          title={locale === "zh" ? "运营风险雷达" : "Radar opérationnel"}
          description={locale === "zh" ? "保洁、维修、到期与回款压力" : "Ménage, maintenance, échéances, paiements"}
        >
          <RadarChart
            axes={[
              { label: locale === "zh" ? "待保洁" : "Ménage", value: risks.cleaning / riskMax, tone: "amber" },
              { label: locale === "zh" ? "维修" : "Maintenance", value: risks.maintenance / riskMax, tone: "red" },
              { label: locale === "zh" ? "合同到期" : "Baux", value: risks.leaseExpiring.length / riskMax, tone: "blue" },
              { label: locale === "zh" ? "出售回款" : "Ventes", value: risks.saleWithPending.length / riskMax, tone: "green" },
            ]}
          />
        </DataVizCard>
      </div>

      {/* Risk alerts */}
      {(risks.cleaning > 0 || risks.maintenance > 0 || risks.leaseExpiring.length > 0 || risks.saleWithPending.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accentRed-100 bg-accentRed-50/70 px-4 py-2.5 text-sm shadow-xs">
          <AlertTriangle className="h-4 w-4 text-accentRed-500 shrink-0" />
          <span className="text-xs font-semibold text-accentRed-700">{locale === "zh" ? "待处理" : "Attention"}:</span>
          {risks.cleaning > 0 && <span className="text-xs text-accentRed-600">{risks.cleaning} {locale === "zh" ? "间待保洁" : "ménages"}</span>}
          {risks.maintenance > 0 && <span className="text-xs text-accentRed-600">{risks.maintenance} {locale === "zh" ? "间维修" : "maintenance"}</span>}
          {risks.leaseExpiring.length > 0 && <span className="text-xs text-accentRed-600">{risks.leaseExpiring.length} {locale === "zh" ? "份合同将到期" : "baux expirant"}</span>}
          {risks.saleWithPending.length > 0 && <span className="text-xs text-accentRed-600">{risks.saleWithPending.length} {locale === "zh" ? "笔出售待回款" : "ventes en attente"}</span>}
        </div>
      )}

      {/* Room board */}
      {activeBuildings.filter(b => b.id === selectedBuildingId).map(building => {
        const bUnits = buildingUnits.get(building.id) ?? [];
        if (bUnits.length === 0) return null;

        const bStates = sortUnitsForBuilding(bUnits, building.code).map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks, todayStr));
        const visibleBStates = selectedStatus ? bStates.filter(s => s.status === selectedStatus) : bStates;
        if (visibleBStates.length === 0) return null;
        const floorGroups = groupStatesByFloor(visibleBStates, locale, building.code);
        if (floorGroups.length === 0) return null;

        const bOccupied = visibleBStates.filter(s => s.status === "dailyOccupied" || s.status === "leased" || s.status === "sold" || s.status === "ownerOccupied").length;
        const bTotal = visibleBStates.length;

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
              <RoomLegend items={STATUS_ORDER.filter(s => bStates.some(state => state.status === s)).map(s => ({ key: s, label: s === "ownerOccupied" ? (locale === "zh" ? "自用" : "Usage interne") : t.statuses[s], color: STATUS_DOT[s] }))} />
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
                        statusLabel={s.status === "ownerOccupied" ? (locale === "zh" ? "自用" : "Usage interne") : undefined}
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
