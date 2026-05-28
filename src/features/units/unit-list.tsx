"use client";

import { useMemo, useState } from "react";
import { Building2, Eye } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { UnitFilters } from "./unit-filters";
import { UnitDetailPanel } from "./unit-detail-panel";
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
        <AssetMetric label={locale === "zh" ? "住宿房源" : "Appartements"} value={summary.apartments} tone="total" />
        <AssetMetric label={dictionaries[locale].statuses.sold} value={summary.sold} tone="sold" />
        <AssetMetric label={dictionaries[locale].statuses.leased} value={summary.leased} tone="leased" />
        <AssetMetric label={locale === "zh" ? "日租/预订" : "Jour"} value={summary.daily} tone="daily" />
        <AssetMetric label={dictionaries[locale].statuses.available} value={summary.available} tone="available" />
        <AssetMetric label={locale === "zh" ? "非住宿资产" : "Autres actifs"} value={summary.nonApartment} tone="other" />
      </div>

      <div className="mb-4 rounded-2xl border border-neutral-200 bg-white p-3 shadow-natural">
        <UnitFilters
          locale={locale}
          selectedFloor={selectedFloor} selectedStatus={selectedStatus}
          selectedKind={selectedKind} selectedBusiness={selectedBusiness}
          floors={floors}
          onFloorChange={setSelectedFloor} onStatusChange={setSelectedStatus}
          onKindChange={setSelectedKind} onBusinessChange={setSelectedBusiness}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-neutral-200 bg-white py-20 shadow-natural">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-neutral-50">
            <Building2 className="h-6 w-6 text-brand-neutral-800" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-brand-neutral-950">{t.empty}</p>
            <p className="mt-1 text-xs font-medium text-brand-neutral-800">
              {locale === "zh" ? "请先在设置中导入楼栋和房间" : "Importez d'abord l'immeuble dans Parametres"}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-natural">
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
                      aria-label={`${unit.unit_no} - ${t.actions.viewDetail}`}
                      className="cursor-pointer transition-colors duration-fast hover:bg-brand-indigo-50/50 focus-visible:bg-brand-indigo-50/70 focus-visible:outline-none"
                      onClick={() => setDetailUnitId(unit.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") setDetailUnitId(unit.id); }}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-black text-brand-neutral-950">{unit.unit_no}</span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-brand-neutral-900">{unit.floor_label}</td>
                      <td className="px-4 py-3 text-sm font-medium text-brand-neutral-900">{t.kinds[unit.kind]}</td>
                      <td className="px-4 py-3">
                        <UnitStatusPill status={unit.status} locale={locale} />
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-brand-neutral-900">
                        {enabledFlags.map((f) => t.businessTypes[f.business_type]).join(" / ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold tabular-nums text-brand-neutral-900">
                        {dailyFlag?.default_price_xof != null
                          ? Number(dailyFlag.default_price_xof).toLocaleString()
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailUnitId(unit.id);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-brand-indigo-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-indigo-600"
                          >
                            <Eye className="h-3 w-3" />
                            {locale === "zh" ? "查看房源" : "Voir"}
                          </button>
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

      <p className="mt-3 text-xs font-medium text-brand-neutral-800" role="status" aria-live="polite">
        {filtered.length} / {units.length} {locale === "fr" ? "lots" : "套房源"}
      </p>

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

function AssetMetric({ label, value, tone }: { label: string; value: number; tone: "total" | "sold" | "leased" | "daily" | "available" | "other" }) {
  const styles = {
    total: "border-brand-warm-300 bg-white text-brand-ink-900",
    sold: "border-brand-warm-300 bg-brand-warm-100 text-brand-ink-800",
    leased: "border-brand-cyan-200 bg-brand-cyan-50 text-brand-cyan-900",
    daily: "border-brand-indigo-200 bg-brand-indigo-50 text-brand-indigo-900",
    available: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
    other: "border-brand-warm-300 bg-white text-brand-neutral-700",
  }[tone];
  return (
    <div className={cn("overflow-hidden rounded-2xl border px-4 py-3 shadow-sm", styles)}>
      <p className="text-xs font-black text-current opacity-85">{label}</p>
      <p className="mt-1 text-[26px] font-black leading-none text-current tabular-nums">{value}</p>
    </div>
  );
}

function UnitStatusPill({ status, locale }: { status: UnitStatus; locale: Locale }) {
  const label = dictionaries[locale].statuses[status];
  const styles: Record<UnitStatus, string> = {
    sold: "bg-brand-warm-100 text-brand-ink-800 ring-brand-warm-300",
    leased: "bg-brand-cyan-50 text-brand-cyan-800 ring-brand-cyan-200",
    daily_occupied: "bg-brand-indigo-50 text-brand-indigo-800 ring-brand-indigo-200",
    reserved: "bg-brand-indigo-100 text-brand-indigo-900 ring-brand-indigo-300",
    cleaning_pending: "bg-brand-green-100 text-brand-green-900 ring-brand-green-300",
    available: "bg-brand-green-50 text-brand-green-800 ring-brand-green-200",
    maintenance: "bg-brand-red-500 text-white ring-brand-red-600",
    locked: "bg-white text-brand-neutral-950 ring-brand-neutral-600",
  };

  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-black ring-1 ring-inset", styles[status])}
      role="status"
      aria-label={label}
    >
      {label}
    </span>
  );
}
