"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Eye } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
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
  const [selectedKind, setSelectedKind] = useState("all");
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

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-brand-warm-400 bg-white py-20 shadow-natural">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-warm-50">
            <Building2 className="h-6 w-6 text-brand-ink-300" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-brand-ink-500">{t.empty}</p>
            <p className="mt-1 text-xs text-brand-ink-300">
              {locale === "zh" ? "请先在设置中导入楼栋和房间" : "Importez d'abord l'immeuble dans Parametres"}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-brand-warm-400 bg-white shadow-natural">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-brand-warm-400 bg-brand-warm-50">
                  {t.headers.map((h) => (
                    <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-brand-ink-500">
                      {h}
                    </th>
                  ))}
                  <th className="sr-only px-4 py-3">{t.actions.viewDetail}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-warm-400">
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
                      className="cursor-pointer transition-colors duration-fast hover:bg-brand-orange-50/40 focus-visible:bg-brand-orange-50/60 focus-visible:outline-none"
                      onClick={() => setDetailUnitId(unit.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") setDetailUnitId(unit.id); }}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-semibold text-brand-ink-900">{unit.unit_no}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-brand-ink-500">{unit.floor_label}</td>
                      <td className="px-4 py-3 text-sm text-brand-ink-500">{t.kinds[unit.kind]}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={unit.status} locale={locale} />
                      </td>
                      <td className="px-4 py-3 text-sm text-brand-ink-500">
                        {enabledFlags.map((f) => t.businessTypes[f.business_type]).join(" / ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-brand-ink-500">
                        {dailyFlag?.default_price_xof != null
                          ? Number(dailyFlag.default_price_xof).toLocaleString()
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={routeFor(locale, `/units/${unit.id}`)}
                            onClick={e => e.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded bg-brand-ink-900 px-2 py-1 text-[10px] font-semibold text-white hover:bg-brand-ink-700"
                          >
                            <Eye className="h-3 w-3" />
                            {locale === "zh" ? "档案" : "Profil"}
                          </Link>
                          <span className="text-xs font-medium text-brand-orange-500 transition-colors duration-fast group-hover:underline">
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
      <p className="mt-3 text-xs text-brand-ink-300" role="status" aria-live="polite">
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
