"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, ArrowRight } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { cn, sortUnits } from "@/lib/utils";
import { UnitFilters } from "./unit-filters";
import { UnitDetailPanel } from "./unit-detail-panel";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
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
  if (status === "available") return locale === "zh" ? "可安排入住" : "Disponible";
  if (status === "cleaning_pending") return locale === "zh" ? "待保洁" : "Menage";
  if (status === "maintenance" || status === "locked") return locale === "zh" ? "暂停使用" : "Bloque";
  if (status === "sold") return locale === "zh" ? "已售房源" : "Vendu";
  if (status === "leased") return locale === "zh" ? "长租客户" : "Locataire";
  if (status === "reserved") return locale === "zh" ? "已预订" : "Reserve";
  return locale === "zh" ? "日租客户" : "Client";
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

  const detailUnit = detailUnitId ? units.find((u) => u.id === detailUnitId) : null;
  const apartments = useMemo(() => units.filter(u => u.kind === "apartment"), [units]);
  const nonApartments = useMemo(() => units.filter(u => u.kind !== "apartment"), [units]);

  // Group apartments by floor for matrix view
  const floorGroups = useMemo(() => {
    const g = new Map<string, UnitRow[]>();
    for (const u of apartments) { const f = u.floor_label ?? "?"; if (!g.has(f)) g.set(f, []); g.get(f)!.push(u); }
    return Array.from(g.entries()).sort((a,b) => { const an=parseInt(a[0],10),bn=parseInt(b[0],10); if(!isNaN(an)&&!isNaN(bn)) return an-bn; return a[0].localeCompare(b[0]); });
  }, [apartments]);

  const summary = useMemo(() => ({
    apartments: apartments.length,
    sold: apartments.filter(u => u.status === "sold").length,
    leased: apartments.filter(u => u.status === "leased").length,
    daily: apartments.filter(u => u.status === "daily_occupied" || u.status === "reserved").length,
    available: apartments.filter(u => u.status === "available").length,
    maintenance: apartments.filter(u => u.status === "maintenance" || u.status === "locked" || u.status === "cleaning_pending").length,
    nonApartment: nonApartments.length,
  }), [apartments, nonApartments]);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Stat cards ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <MetricCard title={locale === "zh" ? "住宿房源" : "Appartements"} value={String(summary.apartments)} tone="neutral" />
        <MetricCard title={statusLabels.sold} value={String(summary.sold)} tone="neutral" />
        <MetricCard title={statusLabels.leased} value={String(summary.leased)} tone="neutral" />
        <MetricCard title={locale === "zh" ? "日租/预订" : "Jour"} value={String(summary.daily)} tone="neutral" />
        <MetricCard title={statusLabels.available} value={String(summary.available)} tone="neutral" />
        <MetricCard title={locale === "zh" ? "维护中" : "Maintenance"} value={String(summary.maintenance)} tone="neutral" />
        <MetricCard title={locale === "zh" ? "非住宿" : "Autres"} value={String(summary.nonApartment)} tone="neutral" />
      </div>

      {/* ── Filter bar ── */}
      <Card>
        <CardContent className="py-3">
          <UnitFilters locale={locale} selectedFloor={selectedFloor} selectedStatus={selectedStatus} selectedKind={selectedKind} selectedBusiness={selectedBusiness} floors={floors}
            onFloorChange={setSelectedFloor} onStatusChange={setSelectedStatus} onKindChange={setSelectedKind} onBusinessChange={setSelectedBusiness} />
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState icon={<Building2 className="h-10 w-10" />} title={t.empty} description={locale === "zh" ? "请先在设置中导入楼栋和房间" : "Importez d'abord l'immeuble dans Parametres"} />
      ) : (
        <>
          {/* ── Apartment matrix — floor groups, 6 per row ── */}
          {floorGroups.length > 0 && (
            <div className="space-y-4">
              {floorGroups.map(([floor, floorUnits]) => (
                <div key={floor}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground">{locale === "zh" ? `${floor}层` : floor}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{floorUnits.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {sortUnits(floorUnits).map(u => (
                      <Link key={u.id} href={routeFor(locale, `/units/${u.id}`)} className="block">
                        <RoomTile unit={u} locale={locale} />
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Non-apartment assets ── */}
          {nonApartments.length > 0 && (
            <Card>
              <CardContent className="py-3">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">{locale === "zh" ? "非住宿资产" : "Autres actifs"}</p>
                <div className="flex flex-wrap gap-2">
                  {nonApartments.map(u => (
                    <Link key={u.id} href={routeFor(locale, `/units/${u.id}`)} className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors">
                      <span className="font-mono font-bold">{u.unit_no}</span>
                      <span className="text-muted-foreground">{t.kinds[u.kind]}</span>
                      <StatusDot status={u.status} />
                      <span className="text-muted-foreground">{statusLabels[u.status]}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Full table (secondary view) ── */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <tr>{t.headers.map((h) => (<th key={h} className="px-4 py-2.5">{h}</th>))}<th className="w-10 px-4 py-2.5" /></tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((unit) => {
                    const flags = businessFlagsMap[unit.id] ?? [];
                    const enabledFlags = flags.filter((f) => f.is_enabled);
                    const dailyFlag = flags.find((f) => f.business_type === "daily_rental" && f.is_enabled);
                    return (
                      <tr key={unit.id} className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => setDetailUnitId(unit.id)}>
                        <td className="px-4 py-2.5"><span className="font-mono text-xs font-bold">{unit.unit_no}</span></td>
                        <td className="px-4 py-2.5 text-sm">{unit.floor_label}</td>
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">{t.kinds[unit.kind]}</td>
                        <td className="px-4 py-2.5"><StatusPill status={unit.status} locale={locale} /></td>
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">{enabledFlags.map((f) => t.businessTypes[f.business_type]).join(" / ") || "-"}</td>
                        <td className="px-4 py-2.5 text-sm tabular-nums">{dailyFlag?.default_price_xof != null ? Number(dailyFlag.default_price_xof).toLocaleString() : "-"}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDetailUnitId(unit.id); }}><ArrowRight className="h-3.5 w-3.5" /></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <p className="text-xs text-muted-foreground" role="status">{filtered.length} / {units.length} {locale === "fr" ? "lots" : "套房源"}</p>

      {detailUnit && (
        <UnitDetailPanel key={`${detailUnit.id}-${refreshKey}`} unit={detailUnit} businessFlags={businessFlagsMap[detailUnit.id] ?? []} auditLogs={auditLogsMap[detailUnit.id] ?? []}
          locale={locale} onClose={() => setDetailUnitId(null)} onStatusChanged={() => setRefreshKey((k) => k + 1)} />
      )}
    </div>
  );
}

// ── Lightweight RoomTile for the apartment matrix ──

function RoomTile({ unit, locale }: { unit: UnitRow; locale: Locale }) {
  const status = unitToRoomStatus(unit.status);
  const bg: Record<string, string> = {
    sold: "bg-[#505080]", leased: "bg-[#7050A0]", daily_occupied: "bg-[#5090C0]", dailyOccupied: "bg-[#5090C0]",
    reserved: "bg-[#A0C0E0]", cleaning_pending: "bg-[#5AB5B8]", cleaningPending: "bg-[#5AB5B8]",
    maintenance: "bg-[#F0A080]", available: "bg-[#F0E0D0]",
  };
  const text: Record<string, string> = {
    sold: "text-white", leased: "text-white", daily_occupied: "text-white", dailyOccupied: "text-white",
    reserved: "text-[#1F4564]", cleaning_pending: "text-white", cleaningPending: "text-white",
    maintenance: "text-[#673522]", available: "text-[#4F4238]",
  };
  return (
    <div className={cn("flex h-[72px] w-[120px] flex-col items-center justify-center gap-0.5 rounded-xl shadow-sm transition-shadow hover:shadow-md", bg[status], text[status])}>
      <span className="font-mono text-xs font-bold">{unit.unit_no}</span>
      <span className="text-[11px] font-medium">{statusCustomerName(unit.status, locale)}</span>
    </div>
  );
}

// ── Status dot ──
function StatusDot({ status }: { status: UnitStatus }) {
  const dots: Record<string, string> = { sold: "bg-[#505080]", leased: "bg-[#7050A0]", daily_occupied: "bg-[#5090C0]", reserved: "bg-[#A0C0E0]", cleaning_pending: "bg-[#5AB5B8]", maintenance: "bg-[#F0A080]", available: "bg-[#F0E0D0]", locked: "bg-gray-300" };
  return <span className={cn("h-2 w-2 rounded-full shrink-0", dots[status] ?? "bg-gray-300")} />;
}

// ── Status pill for table ──
function StatusPill({ status, locale }: { status: UnitStatus; locale: Locale }) {
  const label = dictionaries[locale].statuses[status];
  const styles: Record<string, string> = {
    sold: "bg-warm-100 text-ink-700 ring-warm-300", leased: "bg-[#7050A0]/10 text-[#5C4388] ring-[#7050A0]/20",
    daily_occupied: "bg-[#5090C0]/10 text-[#376F99] ring-[#5090C0]/20", reserved: "bg-[#A0C0E0]/20 text-[#315E83] ring-[#A0C0E0]/30",
    cleaning_pending: "bg-[#5AB5B8]/10 text-[#32757A] ring-[#5AB5B8]/20", available: "bg-[#F0E0D0]/30 text-[#5D4B3F] ring-[#F0E0D0]",
    maintenance: "bg-red-50 text-red-700 ring-red-200", locked: "bg-muted text-muted-foreground ring-border",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", styles[status] ?? "")}>{label}</span>
  );
}
