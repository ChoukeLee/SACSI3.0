"use client";

import { useEffect, useState, useMemo } from "react";
import { Banknote, Clock3, TrendingUp, WalletCards } from "lucide-react";
import { getDailyRoomStateForDate } from "@/features/daily-rentals/room-status";
import { FinanceDetailPanel } from "@/features/management/finance-detail-panel";
import type { ManagementFinanceSnapshot } from "@/features/management/finance-snapshot";
import { RoomCard } from "@/components/room-card";
import { RoomBoard } from "@/components/room-board";
import { RoomLegend } from "@/components/room-legend";
import { FilterBar, MetricGrid, SegmentedControl, StatTile } from "@/components/ui/operational";
import { getRoomCardActions } from "@/lib/room-card-actions";
import { isOwnerOccupiedUnit } from "@/lib/unit-display";
import { referencedLeaseContractNo, unitCardPartyFromNotes, unresolvedUnitCardParty } from "@/lib/unit-card-party";
import {
  isSacsi5CompanyOwnedOffice,
} from "@/lib/sacsi5-unit-display";
import type { Locale, ManagementDict } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { floorSortValue, formatXof, cn, sortUnitsForBuilding } from "@/lib/utils";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, CustomerRow,
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
  sold: "#69B8E3", leased: "#6D879C", dailyOccupied: "#1E83CC",
  reserved: "#D39B0B", cleaningPending: "#50BFAE", maintenance: "#EA637E",
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

function summarizeFinanceItems(items: ManagementFinanceSnapshot["items"]): ManagementFinanceSnapshot["summary"] {
  const today = new Date().toISOString().slice(0, 10);
  const due = items.filter((item) => item.dueDate <= today && item.outstandingXof > 0);
  const upcoming = items.filter((item) => item.dueDate > today && item.outstandingXof > 0);
  const outstanding = due.reduce((sum, item) => sum + item.outstandingXof, 0);
  const overdue = due
    .filter((item) => item.dueDate < today)
    .reduce((sum, item) => sum + item.outstandingXof, 0);

  return {
    totalReceivable: due.reduce((sum, item) => sum + item.amountXof, 0),
    totalPaid: due.reduce((sum, item) => sum + item.paidAmountXof, 0),
    monthCollected: 0,
    outstanding,
    overdue,
    upcoming: upcoming.reduce((sum, item) => sum + item.outstandingXof, 0),
    count: due.length,
    historicalPending: 0,
    historicalPendingCount: 0,
    collectionRate: 0,
  };
}

export function ManagementOverviewClient({
  snapshot, buildings, units, dailyBookings, leaseContracts, saleContracts,
  cleaningTasks, customers, locale, t,
}: {
  snapshot: ManagementFinanceSnapshot;
  buildings: BuildingRow[]; units: UnitRow[]; dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[]; saleContracts: SaleContractRow[];
  cleaningTasks: { unit_id: string; is_completed: boolean }[];
  customers: CustomerRow[]; locale: Locale; t: ManagementDict;
}) {
  const activeBuildings = useMemo(() => buildings.filter((building) => building.is_active), [buildings]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>(activeBuildings[0]?.id ?? "");
  const selectedBuilding = activeBuildings.find((building) => building.id === selectedBuildingId) ?? activeBuildings[0] ?? null;

  useEffect(() => {
    if (activeBuildings.length === 0) {
      setSelectedBuildingId("");
      return;
    }
    if (!activeBuildings.some((building) => building.id === selectedBuildingId)) {
      setSelectedBuildingId(activeBuildings[0].id);
    }
  }, [activeBuildings, selectedBuildingId]);

  return (
    <>
      <FinanceSectionClient
        snapshot={snapshot}
        selectedBuildingId={selectedBuilding?.id ?? null}
        selectedBuildingName={selectedBuilding?.display_name ?? null}
        locale={locale}
        t={t}
      />
      <UnitDataClient
        buildings={buildings}
        units={units}
        dailyBookings={dailyBookings}
        leaseContracts={leaseContracts}
        saleContracts={saleContracts}
        cleaningTasks={cleaningTasks}
        customers={customers}
        selectedBuildingId={selectedBuilding?.id ?? ""}
        onSelectedBuildingIdChange={setSelectedBuildingId}
        locale={locale}
        t={t}
      />
    </>
  );
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
  snapshot, selectedBuildingId, selectedBuildingName, locale, t,
}: {
  snapshot: ManagementFinanceSnapshot;
  selectedBuildingId?: string | null;
  selectedBuildingName?: string | null;
  locale: Locale; t: ManagementDict;
}) {
  const [detail, setDetail] = useState<string | null>(null);

  const filteredItems = useMemo(
    () => selectedBuildingId
      ? snapshot.items.filter((item) => item.buildingId === selectedBuildingId)
      : snapshot.items,
    [snapshot.items, selectedBuildingId],
  );
  const filteredPayments = useMemo(
    () => selectedBuildingId
      ? snapshot.paymentItems.filter((item) => item.buildingId === selectedBuildingId)
      : snapshot.paymentItems,
    [snapshot.paymentItems, selectedBuildingId],
  );
  const stats = useMemo(() => {
    const receivableStats = summarizeFinanceItems(filteredItems);
    return {
      ...receivableStats,
      monthCollected: filteredPayments.reduce((sum, item) => sum + (item.isRefund ? -item.amountXof : item.amountXof), 0),
    };
  }, [filteredItems, filteredPayments]);
  const blocks = [
    { key: "collected", label: locale === "zh" ? "本月已收" : "Encaissé ce mois", value: stats.monthCollected, color: "accentGreen" as const, icon: Banknote },
    { key: "outstanding", label: locale === "zh" ? "已确认未收" : "Dû confirmé", value: stats.outstanding, color: "accentAmber" as const, icon: WalletCards },
    { key: "overdue", label: locale === "zh" ? "逾期" : "En retard", value: stats.overdue, color: "accentRed" as const, icon: Clock3 },
    { key: "upcoming", label: locale === "zh" ? "15天内应收" : "Dû sous 15j", value: stats.upcoming, color: "accentBlue" as const, icon: TrendingUp },
  ];

  return (
    <>
      <div id="finance" className="scroll-mt-20 rounded-xl border border-border bg-card p-3 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{locale === "zh" ? "财务概览" : "Vue financiere"}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {locale === "zh"
                ? `${selectedBuildingName ?? "全部楼栋"} · 当前管理口径 · 不含历史待核 · 卡片与明细同口径`
                : `${selectedBuildingName ?? "Tous les bâtiments"} · ${stats.count} créances à ce jour · Cliquez pour le détail`}
            </p>
          </div>
          {!selectedBuildingId && snapshot.summary.historicalPendingCount > 0 && <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold tabular-nums">{snapshot.summary.historicalPendingCount} {locale === "zh" ? "笔" : "lignes"}</p>
            <p className="text-[11px] text-muted-foreground">{locale === "zh" ? "历史待核（未计入）" : "Historique à vérifier (exclu)"}</p>
          </div>}
        </div>
        <MetricGrid columns={4}>
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
        </MetricGrid>
      </div>
      {detail != null && (
        <FinanceDetailPanel
          open={detail as "collected" | "outstanding" | "overdue" | "upcoming"}
          onClose={() => setDetail(null)}
          items={filteredItems}
          paymentItems={filteredPayments}
          asOf={snapshot.asOf}
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
  cleaningTasks, customers, selectedBuildingId, onSelectedBuildingIdChange, locale, t,
}: {
  buildings: BuildingRow[]; units: UnitRow[]; dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[]; saleContracts: SaleContractRow[];
  cleaningTasks: { unit_id: string; is_completed: boolean }[];
  customers: CustomerRow[];
  selectedBuildingId: string;
  onSelectedBuildingIdChange: (buildingId: string) => void;
  locale: Locale; t: ManagementDict;
}) {
  const sacsi5BuildingId = useMemo(() => buildings.find(b => b.code === "SACSI5")?.id ?? null, [buildings]);
  const operationalUnits = useMemo(
    () => units.filter(u => u.kind === "apartment" || isOwnerOccupiedUnit(u) || (u.kind === "office" && u.building_id === sacsi5BuildingId)),
    [units, sacsi5BuildingId],
  );
  const activeBuildings = useMemo(() => buildings.filter(b => b.is_active), [buildings]);
  const [selectedStatus, setSelectedStatus] = useState<MgmtStatus | null>(null);

  useEffect(() => {
    if (activeBuildings.length === 0) {
      onSelectedBuildingIdChange("");
      return;
    }
    if (!activeBuildings.some((building) => building.id === selectedBuildingId)) {
      onSelectedBuildingIdChange(activeBuildings[0].id);
    }
  }, [activeBuildings, onSelectedBuildingIdChange, selectedBuildingId]);

  const filteredUnits = useMemo(() => {
    return operationalUnits.filter(u => u.building_id === selectedBuildingId);
  }, [operationalUnits, selectedBuildingId]);
  const buildingUnits = useMemo(() => {
    const m = new Map<string, UnitRow[]>();
    for (const b of activeBuildings) m.set(b.id, operationalUnits.filter(u => u.building_id === b.id));
    return m;
  }, [activeBuildings, operationalUnits]);

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

  const totalRooms = filteredUnits.length;
  const occupiedPct = totalRooms > 0 ? Math.round((counts.dailyOccupied + counts.leased + counts.sold + counts.ownerOccupied) / totalRooms * 100) : 0;

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
          onChange={onSelectedBuildingIdChange}
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

      {/* Room board */}
      {activeBuildings.filter(b => b.id === selectedBuildingId).map(building => {
        const bUnits = buildingUnits.get(building.id) ?? [];
        if (bUnits.length === 0) return null;

        const bStates = sortUnitsForBuilding(bUnits, building.code).map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks, todayStr));
        const visibleBStates = selectedStatus ? bStates.filter(s => s.status === selectedStatus) : bStates;
        if (visibleBStates.length === 0) return null;
        // SACSI5's front office plates share their floor with apartment units.
        // Keep them in one floor group so the cards can be compared side by side.
        const assetSections = [{ key: "all", label: null, description: null, states: visibleBStates }];
        if (assetSections.length === 0) return null;

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
            {assetSections.map((section, sectionIndex) => {
              const floorGroups = groupStatesByFloor(section.states, locale, building.code);
              return (
                <section key={section.key} className={sectionIndex > 0 ? "mt-7 border-t border-border/60 pt-5" : ""}>
                  {section.label && (
                    <div className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <h4 className="text-sm font-semibold text-foreground">{section.label}</h4>
                      <span className="text-xs text-muted-foreground">{section.description}</span>
                    </div>
                  )}
                  {floorGroups.map((group, groupIndex) => {
                    return (
                      <div key={group.key} className={groupIndex > 0 ? "mt-[18px]" : ""}>
                        <div className="mb-2 flex min-h-5 items-center gap-2 text-[12px] text-[#5D7186]">
                          <p className="font-semibold">{group.label} <span className="font-normal text-[#5D7186]/60">{group.states.length}</span></p>
                        </div>
                        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6">
                          {group.states.map(s => {
                            const detailHref = routeFor(locale, `/units/${s.unit.id}`);
                            const actions = getRoomCardActions(s.status, {
                              locale, unitId: s.unit.id, unitNo: s.unit.unit_no ?? undefined,
                              detailHref,
                              dailyHref: routeFor(locale, "/daily-rentals"),
                              leaseHref: routeFor(locale, "/leases"),
                              saleHref: routeFor(locale, "/sales"),
                            });
                            const companyOwnedOffice = isSacsi5CompanyOwnedOffice(building.code, s.unit);
                            return (
                              <RoomCard
                                key={s.unit.id}
                                roomNo={s.unit.unit_no ?? "?"}
                                status={s.status}
                                statusLabel={companyOwnedOffice
                                  ? (locale === "zh" ? "公司自购 · 自用" : "Acheté · usage interne")
                                  : s.status === "ownerOccupied" ? (locale === "zh" ? "自用" : "Usage interne") : undefined}
                                customerName={stateCustomerName(s, customerNameById, locale)}
                                dateText={stateDateText(s, locale)}
                                href={detailHref}
                                actions={actions}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </RoomBoard>
        );
      })}
    </>
  );
}
