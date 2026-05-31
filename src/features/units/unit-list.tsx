"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Building2 } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { cn, sortUnits } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { UnitDetailPanel } from "./unit-detail-panel";
import { UnitFilters } from "./unit-filters";
import type { UnitRow } from "@/types/database";
import type { BusinessType, UnitStatus } from "@/types/domain";

interface UnitBusinessFlag {
  business_type: BusinessType;
  is_enabled: boolean;
  default_price_xof: number | null;
}

interface AuditLogEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface UnitListProps {
  units: UnitRow[];
  businessFlagsMap: Record<string, UnitBusinessFlag[]>;
  auditLogsMap: Record<string, AuditLogEntry[]>;
  locale: Locale;
}

const STATUS_DOT: Record<string, string> = {
  sold: "bg-[#075A9A]",
  leased: "bg-[#A898E8]",
  daily_occupied: "bg-[#62B6F5]",
  reserved: "bg-[#E8C840]",
  cleaning_pending: "bg-[#5CC4B8]",
  maintenance: "bg-[#F08090]",
  locked: "bg-gray-400",
  available: "bg-[#A0D0E8]",
};

export function UnitList({ units, businessFlagsMap, auditLogsMap, locale }: UnitListProps) {
  const t = dictionaries[locale].units;
  const statusLabels = dictionaries[locale].statuses;
  const [selectedFloor, setSelectedFloor] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedKind, setSelectedKind] = useState("apartment");
  const [selectedBusiness, setSelectedBusiness] = useState("all");
  const [detailUnitId, setDetailUnitId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const floors = useMemo(() => {
    const set = new Set(units.map((u) => u.floor_label));
    return Array.from(set).sort((a, b) => {
      const an = parseInt(a, 10);
      const bn = parseInt(b, 10);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
      return a.localeCompare(b);
    });
  }, [units]);

  const filtered = useMemo(() => {
    return units.filter((unit) => {
      if (selectedFloor !== "all" && unit.floor_label !== selectedFloor) return false;
      if (selectedStatus !== "all" && unit.status !== selectedStatus) return false;
      if (selectedKind !== "all" && unit.kind !== selectedKind) return false;
      if (selectedBusiness !== "all") {
        const flags = businessFlagsMap[unit.id] ?? [];
        return flags.some((flag) => flag.business_type === selectedBusiness && flag.is_enabled);
      }
      return true;
    });
  }, [units, selectedFloor, selectedStatus, selectedKind, selectedBusiness, businessFlagsMap]);

  const apartmentCount = useMemo(() => units.filter((unit) => unit.kind === "apartment").length, [units]);

  const detailUnit = detailUnitId ? units.find((unit) => unit.id === detailUnitId) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          {locale === "zh" ? "房源总览" : "Vue d'ensemble"}
        </p>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {locale === "zh" ? "住宿资产" : "Actifs résidentiels"}
          </h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            {apartmentCount} {locale === "zh" ? "套公寓" : "appartements"}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <UnitFilters
          locale={locale}
          selectedFloor={selectedFloor}
          selectedStatus={selectedStatus}
          selectedKind={selectedKind}
          selectedBusiness={selectedBusiness}
          floors={floors}
          onFloorChange={setSelectedFloor}
          onStatusChange={setSelectedStatus}
          onKindChange={setSelectedKind}
          onBusinessChange={setSelectedBusiness}
        />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {filtered.length} / {units.length} {locale === "fr" ? "lots" : "套房源"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title={t.empty}
          description={locale === "zh" ? "请先在设置中导入楼栋和房间" : "Importez d'abord l'immeuble dans Paramètres"}
        />
      ) : (
        <div className="table-shell">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {t.headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {sortUnits(filtered).map((unit) => {
                  const flags = businessFlagsMap[unit.id] ?? [];
                  const enabledFlags = flags.filter((flag) => flag.is_enabled);
                  const dailyFlag = flags.find((flag) => flag.business_type === "daily_rental" && flag.is_enabled);
                  return (
                    <tr key={unit.id} className="cursor-pointer" onClick={() => setDetailUnitId(unit.id)}>
                      <td><span className="font-mono text-xs font-bold">{unit.unit_no}</span></td>
                      <td className="text-sm">{unit.floor_label}</td>
                      <td className="text-sm text-muted-foreground">{t.kinds[unit.kind]}</td>
                      <td><StatusPill status={unit.status} locale={locale} /></td>
                      <td className="text-sm text-muted-foreground">{enabledFlags.map((flag) => t.businessTypes[flag.business_type]).join(" / ") || "-"}</td>
                      <td className="table-cell-amount">{dailyFlag?.default_price_xof != null ? Number(dailyFlag.default_price_xof).toLocaleString() : "-"}</td>
                      <td className="table-cell-action">
                        <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); setDetailUnitId(unit.id); }}>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailUnit && (
        <UnitDetailPanel
          key={`${detailUnit.id}-${refreshKey}`}
          unit={detailUnit}
          businessFlags={businessFlagsMap[detailUnit.id] ?? []}
          auditLogs={auditLogsMap[detailUnit.id] ?? []}
          locale={locale}
          onClose={() => setDetailUnitId(null)}
          onStatusChanged={() => setRefreshKey((key) => key + 1)}
        />
      )}
    </div>
  );
}

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
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", styles[status] ?? "")}>
      {label}
    </span>
  );
}
