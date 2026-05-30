"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, ChevronDown, ChevronUp, Home, Key, AlertTriangle } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { cn, sortUnits } from "@/lib/utils";
import { UnitFilters } from "./unit-filters";
import { UnitDetailPanel } from "./unit-detail-panel";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import type { UnitRow } from "@/types/database";
import type { BusinessType, UnitStatus } from "@/types/domain";
import type { RoomStatus } from "@/components/room-card";

interface UnitBusinessFlag { business_type: BusinessType; is_enabled: boolean; default_price_xof: number | null }
interface AuditLogEntry { id: string; action: string; metadata: Record<string, unknown>; created_at: string }
interface UnitListProps { units: UnitRow[]; businessFlagsMap: Record<string, UnitBusinessFlag[]>; auditLogsMap: Record<string, AuditLogEntry[]>; locale: Locale }

const unitToRoomStatus = (s: UnitStatus): RoomStatus => {
  const m: Record<string, RoomStatus> = { sold: "sold", leased: "leased", daily_occupied: "daily_occupied", reserved: "reserved", cleaning_pending: "cleaning_pending", maintenance: "maintenance", available: "available", locked: "maintenance" };
  return m[s] ?? "available";
};

const statusCustomerName = (status: UnitStatus, locale: Locale): string => {
  if (status === "available") return locale === "zh" ? "空闲" : "Libre";
  if (status === "cleaning_pending") return locale === "zh" ? "待洁" : "Ménage";
  if (status === "maintenance" || status === "locked") return locale === "zh" ? "维修" : "Bloqué";
  return "";
};

const STATUS_DOT: Record<string, string> = {
  sold: "bg-[#075A9A]", leased: "bg-[#A898E8]", daily_occupied: "bg-[#62B6F5]",
  reserved: "bg-[#E8C840]", cleaning_pending: "bg-[#5CC4B8]",
  maintenance: "bg-[#F08090]", locked: "bg-gray-400", available: "bg-[#A0D0E8]",
};

export function UnitList({ units, businessFlagsMap, auditLogsMap, locale }: UnitListProps) {
  const t = dictionaries[locale].units;
  const statusLabels = dictionaries[locale].statuses;
  const [selectedFloor, setSelectedFloor] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedKind, setSelectedKind] = useState("all");
  const [selectedBusiness, setSelectedBusiness] = useState("all");
  const [detailUnitId, setDetailUnitId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showTable, setShowTable] = useState(false);

  const floors = useMemo(() => {
    const set = new Set(units.map((u) => u.floor_label));
    return Array.from(set).sort((a, b) => { const an = parseInt(a,10), bn = parseInt(b,10); if (!isNaN(an)&&!isNaN(bn)) return an-bn; return a.localeCompare(b); });
  }, [units]);

  const filtered = useMemo(() => {
    return units.filter((u) => {
      if (selectedFloor !== "all" && u.floor_label !== selectedFloor) return false;
      if (selectedStatus !== "all" && u.status !== selectedStatus) return false;
      if (selectedKind !== "all" && u.kind !== selectedKind) return false;
      if (selectedBusiness !== "all") { const flags = businessFlagsMap[u.id] ?? []; return flags.some((f) => f.business_type === selectedBusiness && f.is_enabled); }
      return true;
    });
  }, [units, selectedFloor, selectedStatus, selectedKind, selectedBusiness, businessFlagsMap]);

  const apartments = useMemo(() => units.filter(u => u.kind === "apartment"), [units]);
  const nonApartments = useMemo(() => units.filter(u => u.kind !== "apartment"), [units]);
  const filteredApartments = useMemo(() => filtered.filter(u => u.kind === "apartment"), [filtered]);
  const filteredNonApartments = useMemo(() => filtered.filter(u => u.kind !== "apartment"), [filtered]);

  const floorGroups = useMemo(() => {
    const g = new Map<string, UnitRow[]>();
    for (const u of filteredApartments) { const f = u.floor_label ?? "?"; if (!g.has(f)) g.set(f, []); g.get(f)!.push(u); }
    return Array.from(g.entries()).sort((a,b) => { const an=parseInt(a[0],10),bn=parseInt(b[0],10); if(!isNaN(an)&&!isNaN(bn)) return an-bn; return a[0].localeCompare(b[0]); });
  }, [filteredApartments]);

  const summary = useMemo(() => ({
    apartments: apartments.length,
    sold: apartments.filter(u => u.status === "sold").length,
    leased: apartments.filter(u => u.status === "leased").length,
    daily: apartments.filter(u => u.status === "daily_occupied" || u.status === "reserved").length,
    available: apartments.filter(u => u.status === "available").length,
    maintenance: apartments.filter(u => u.status === "maintenance" || u.status === "locked" || u.status === "cleaning_pending").length,
    nonApartment: nonApartments.length,
  }), [apartments, nonApartments]);

  const detailUnit = detailUnitId ? units.find((u) => u.id === detailUnitId) : null;

  // Asset summary blocks
  const assetBlocks = [
    { key: "apartments", label: locale === "zh" ? "住宿房源" : "Appartements", value: summary.apartments, dot: "bg-foreground", icon: Home },
    { key: "daily", label: locale === "zh" ? "日租/预订" : "Jour", value: summary.daily, dot: "bg-[#5090C0]", icon: undefined },
    { key: "leased", label: statusLabels.leased, value: summary.leased, dot: "bg-[#7050A0]", icon: undefined },
    { key: "sold", label: statusLabels.sold, value: summary.sold, dot: "bg-[#505080]", icon: undefined },
    { key: "available", label: statusLabels.available, value: summary.available, dot: "bg-[#F0E0D0]", icon: undefined },
    { key: "maintenance", label: locale === "zh" ? "维护中" : "Maintenance", value: summary.maintenance, dot: "bg-[#F0A080]", icon: AlertTriangle },
    { key: "nonApartment", label: locale === "zh" ? "非住宿" : "Autres", value: summary.nonApartment, dot: "bg-muted-foreground", icon: Key },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page chrome ── */}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          {locale === "zh" ? "房源总览" : "Vue d'ensemble"}
        </p>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {locale === "zh" ? "住宿资产" : "Actifs résidentiels"}
          </h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            {summary.apartments + summary.nonApartment} {locale === "zh" ? "套房源" : "lots"}
          </span>
        </div>
      </div>

      {/* ── Asset summary strip ── */}
      <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {assetBlocks.map(block => {
          const Icon = block.icon;
          return (
            <div
              key={block.key}
              className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm"
            >
              {Icon ? (
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
              ) : (
                <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", block.dot)} />
              )}
              <div className="min-w-0">
                <p className="text-xl font-bold tracking-tight tabular-nums leading-none">{block.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{block.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Filter toolbar ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm">
        <UnitFilters
          locale={locale}
          selectedFloor={selectedFloor} selectedStatus={selectedStatus}
          selectedKind={selectedKind} selectedBusiness={selectedBusiness}
          floors={floors}
          onFloorChange={setSelectedFloor} onStatusChange={setSelectedStatus}
          onKindChange={setSelectedKind} onBusinessChange={setSelectedBusiness}
        />
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {filtered.length} / {units.length} {locale === "fr" ? "lots" : "套房源"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Building2 className="h-10 w-10" />} title={t.empty} description={locale === "zh" ? "请先在设置中导入楼栋和房间" : "Importez d'abord l'immeuble dans Parametres"} />
      ) : (
        <>
          {/* ── Status legend (compact inline) ── */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {(["sold","leased","daily_occupied","reserved","cleaning_pending","maintenance","available"] as UnitStatus[]).map(s => (
              <span key={s} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOT[s] ?? "bg-gray-300")} />
                {statusLabels[s]}
              </span>
            ))}
          </div>

          {/* ── Apartment matrix ── */}
          {floorGroups.length > 0 && (
            <div className="space-y-5">
              {floorGroups.map(([floor, floorUnits]) => (
                <section key={floor}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">{locale === "zh" ? `${floor}层` : floor}</span>
                    <span className="text-[10px] text-muted-foreground/50">{floorUnits.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {sortUnits(floorUnits).map(u => (
                      <Link key={u.id} href={routeFor(locale, `/units/${u.id}`)} className="block">
                        <RoomTile unit={u} locale={locale} />
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* ── Non-apartment assets ── */}
          {filteredNonApartments.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">{locale === "zh" ? "非住宿资产" : "Autres actifs"}</p>
              <div className="flex flex-wrap gap-2">
                {sortUnits(filteredNonApartments).map(u => (
                  <Link key={u.id} href={routeFor(locale, `/units/${u.id}`)} className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors">
                    <span className="font-mono font-bold">{u.unit_no}</span>
                    <span className="text-muted-foreground">{t.kinds[u.kind]}</span>
                    <span className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOT[u.status] ?? "bg-gray-300")} />
                    <span className="text-muted-foreground">{statusLabels[u.status]}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ── Detail table (collapsible) ── */}
          <div className="border-t border-border/40 pt-5">
            <button
              onClick={() => setShowTable(!showTable)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              <span>{locale === "zh" ? "详细清单" : "Liste détaillée"} · {filtered.length} {locale === "zh" ? "条" : "lignes"}</span>
              {showTable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showTable && (
              <div className="table-shell mt-2">
                <div className="overflow-x-auto">
                  <table>
                    <thead>
                      <tr>{t.headers.map((h) => (<th key={h}>{h}</th>))}<th className="w-10" /></tr>
                    </thead>
                    <tbody>
                      {filtered.map((unit) => {
                        const flags = businessFlagsMap[unit.id] ?? [];
                        const enabledFlags = flags.filter((f) => f.is_enabled);
                        const dailyFlag = flags.find((f) => f.business_type === "daily_rental" && f.is_enabled);
                        return (
                          <tr key={unit.id} className="cursor-pointer" onClick={() => setDetailUnitId(unit.id)}>
                            <td><span className="font-mono text-xs font-bold">{unit.unit_no}</span></td>
                            <td className="text-sm">{unit.floor_label}</td>
                            <td className="text-sm text-muted-foreground">{t.kinds[unit.kind]}</td>
                            <td><StatusPill status={unit.status} locale={locale} /></td>
                            <td className="text-sm text-muted-foreground">{enabledFlags.map((f) => t.businessTypes[f.business_type]).join(" / ") || "-"}</td>
                            <td className="table-cell-amount">{dailyFlag?.default_price_xof != null ? Number(dailyFlag.default_price_xof).toLocaleString() : "-"}</td>
                            <td className="table-cell-action">
                              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDetailUnitId(unit.id); }}><ArrowRight className="h-3.5 w-3.5" /></Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {detailUnit && (
        <UnitDetailPanel
          key={`${detailUnit.id}-${refreshKey}`}
          unit={detailUnit}
          businessFlags={businessFlagsMap[detailUnit.id] ?? []}
          auditLogs={auditLogsMap[detailUnit.id] ?? []}
          locale={locale}
          onClose={() => setDetailUnitId(null)}
          onStatusChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

// ── RoomTile ──
function RoomTile({ unit, locale }: { unit: UnitRow; locale: Locale }) {
  const status = unitToRoomStatus(unit.status);
  const bgMap: Record<string, string> = {
    sold: "bg-[#075A9A]", leased: "bg-[#E8E2FF]", daily_occupied: "bg-[#62B6F5]", dailyOccupied: "bg-[#62B6F5]",
    reserved: "bg-[#FFF6D8]", cleaning_pending: "bg-[#D9F7F0]", cleaningPending: "bg-[#D9F7F0]",
    maintenance: "bg-[#FFE2EA]", available: "bg-[#EAF7FF]",
  };
  const textMap: Record<string, string> = {
    sold: "text-white", leased: "text-[#17324D]", daily_occupied: "text-white", dailyOccupied: "text-white",
    reserved: "text-[#17324D]", cleaning_pending: "text-[#17324D]", cleaningPending: "text-[#17324D]",
    maintenance: "text-[#17324D]", available: "text-[#17324D]",
  };
  return (
    <div className={cn("flex h-[72px] w-[120px] flex-col items-center justify-center gap-0.5 rounded-xl shadow-sm transition-shadow hover:shadow-md", bgMap[status], textMap[status])}>
      <span className="font-mono text-xs font-bold">{unit.unit_no}</span>
      <span className="text-[11px] font-medium">{statusCustomerName(unit.status, locale)}</span>
    </div>
  );
}

// ── StatusPill ──
function StatusPill({ status, locale }: { status: UnitStatus; locale: Locale }) {
  const label = dictionaries[locale].statuses[status];
  const styles: Record<string, string> = {
    sold: "bg-[#075A9A]/10 text-[#075A9A] ring-[#075A9A]/20",
    leased: "bg-[#E8E2FF] text-[#17324D] ring-[#C8BEF0]/60",
    daily_occupied: "bg-[#62B6F5]/10 text-[#1A6090] ring-[#62B6F5]/20",
    reserved: "bg-[#FFF6D8] text-[#17324D] ring-[#E8D5A0]/60",
    cleaning_pending: "bg-[#D9F7F0] text-[#17324D] ring-[#A8E8DB]/60",
    available: "bg-[#EAF7FF] text-[#17324D] ring-[#C0DDF0]/60",
    maintenance: "bg-[#FFE2EA] text-[#17324D] ring-[#F5C0CC]/60",
    locked: "bg-muted text-muted-foreground ring-border",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", styles[status] ?? "")}>{label}</span>
  );
}
