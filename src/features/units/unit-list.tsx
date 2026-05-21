"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Eye } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { UnitFilters } from "./unit-filters";
import { UnitDetailPanel } from "./unit-detail-panel";
import type { UnitRow } from "@/types/database";
import type { BusinessType } from "@/types/domain";

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

export function UnitList({ units, businessFlagsMap, auditLogsMap, locale }: UnitListProps) {
  const t = dictionaries[locale].units;
  const [selectedFloor, setSelectedFloor] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedKind, setSelectedKind] = useState("apartment");
  const [selectedBusiness, setSelectedBusiness] = useState("all");
  const [detailUnitId, setDetailUnitId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const floors = useMemo(() => {
    const set = new Set(units.map((u) => u.floor_label));
    return Array.from(set).sort((a, b) => {
      const aNum = parseInt(a, 10);
      const bNum = parseInt(b, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.localeCompare(b);
    });
  }, [units]);

  const filtered = useMemo(() => {
    return units.filter((u) => {
      if (selectedFloor !== "all" && u.floor_label !== selectedFloor) return false;
      if (selectedStatus !== "all" && u.status !== selectedStatus) return false;
      if (selectedKind !== "all" && u.kind !== selectedKind) return false;
      if (selectedBusiness !== "all") {
        const flags = businessFlagsMap[u.id] ?? [];
        return flags.some((f) => f.business_type === selectedBusiness && f.is_enabled);
      }
      return true;
    });
  }, [units, selectedFloor, selectedStatus, selectedKind, selectedBusiness, businessFlagsMap]);

  const detailUnit = detailUnitId ? units.find((u) => u.id === detailUnitId) : null;
  const apartmentUnits = useMemo(() => units.filter(u => u.kind === "apartment"), [units]);
  const summary = useMemo(() => {
    const source = selectedKind === "all" ? units : filtered;
    return {
      apartments: apartmentUnits.length,
      sold: source.filter(u => u.status === "sold").length,
      leased: source.filter(u => u.status === "leased").length,
      daily: source.filter(u => u.status === "daily_occupied" || u.status === "reserved").length,
      available: source.filter(u => u.status === "available").length,
      nonApartment: units.filter(u => u.kind !== "apartment").length,
    };
  }, [units, filtered, selectedKind, apartmentUnits.length]);

  return (
    <div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <AssetMetric label={locale === "zh" ? "住宿房源" : "Appartements"} value={summary.apartments} tone="ink" />
        <AssetMetric label={dictionaries[locale].statuses.sold} value={summary.sold} tone="slate" />
        <AssetMetric label={dictionaries[locale].statuses.leased} value={summary.leased} tone="indigo" />
        <AssetMetric label={locale === "zh" ? "日租/预订" : "Jour"} value={summary.daily} tone="orange" />
        <AssetMetric label={dictionaries[locale].statuses.available} value={summary.available} tone="green" />
        <AssetMetric label={locale === "zh" ? "非住宿资产" : "Autres actifs"} value={summary.nonApartment} tone="sky" />
      </div>

      {/* Toolbar */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-natural">
        <UnitFilters
          locale={locale}
          selectedFloor={selectedFloor} selectedStatus={selectedStatus}
          selectedKind={selectedKind} selectedBusiness={selectedBusiness}
          floors={floors}
          onFloorChange={setSelectedFloor} onStatusChange={setSelectedStatus}
          onKindChange={setSelectedKind} onBusinessChange={setSelectedBusiness}
        />
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-slate-200 bg-white py-20 shadow-natural">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-50">
            <Building2 className="h-6 w-6 text-slate-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-600">{t.empty}</p>
            <p className="mt-1 text-xs text-slate-400">
              {locale === "zh" ? "请先在设置中导入楼栋和房间" : "Importez d'abord l'immeuble dans Parametres"}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-natural">
          <div className="overflow-x-auto">
            <table className="data-table min-w-[760px] text-sm">
              <thead>
                <tr>
                  {t.headers.map((h) => (
                    <th key={h} className="px-4 py-3">
                      {h}
                    </th>
                  ))}
                  <th className="sr-only px-4 py-3">{t.actions.viewDetail}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((unit) => {
                  const flags = businessFlagsMap[unit.id] ?? [];
                  const enabledFlags = flags.filter((f) => f.is_enabled);
                  const dailyFlag = flags.find((f) => f.business_type === "daily_rental" && f.is_enabled);
                  return (
                    <tr
                      key={unit.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`${unit.unit_no} — ${t.actions.viewDetail}`}
                      className="cursor-pointer transition-colors duration-fast hover:bg-orange-50/60 focus-visible:bg-orange-50/70 focus-visible:outline-none"
                      onClick={() => setDetailUnitId(unit.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") setDetailUnitId(unit.id); }}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-bold text-slate-950">{unit.unit_no}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">{unit.floor_label}</td>
                      <td className="px-4 py-3 text-sm text-slate-500">{t.kinds[unit.kind]}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={unit.status} locale={locale} />
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {enabledFlags.map((f) => t.businessTypes[f.business_type]).join(" / ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-slate-500">
                        {dailyFlag?.default_price_xof != null
                          ? Number(dailyFlag.default_price_xof).toLocaleString()
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={routeFor(locale, `/units/${unit.id}`)}
                            onClick={e => e.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-sm hover:bg-slate-800"
                          >
                            <Eye className="h-3 w-3" />
                            {locale === "zh" ? "档案" : "Profil"}
                          </Link>
                          <span className="text-xs font-semibold text-brand-orange-600 transition-colors duration-fast group-hover:underline">
                            {t.actions.viewDetail} →
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Result count */}
      <p className="mt-3 text-xs text-slate-400" role="status" aria-live="polite">
        {filtered.length} / {units.length} {locale === "fr" ? "lots" : "套房源"}
      </p>

      {/* Detail panel */}
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

function AssetMetric({ label, value, tone }: { label: string; value: number; tone: "ink" | "slate" | "indigo" | "orange" | "green" | "sky" }) {
  const styles = {
    ink: "border-slate-200 bg-white text-slate-950",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    indigo: "border-brand-sky-200 bg-brand-sky-50 text-brand-sky-700",
    orange: "border-brand-orange-200 bg-brand-orange-50 text-brand-orange-700",
    green: "border-brand-green-200 bg-brand-green-50 text-brand-green-700",
    sky: "border-brand-sky-200 bg-brand-sky-50 text-brand-sky-700",
  }[tone];
  return (
    <div className={cn("rounded-2xl border px-4 py-3 shadow-sm", styles)}>
      <p className="text-[11px] font-bold text-current opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
    </div>
  );
}
