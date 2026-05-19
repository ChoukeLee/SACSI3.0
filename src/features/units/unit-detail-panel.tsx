"use client";

import { useState } from "react";
import { X, Camera, ChevronDown } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { UnitRow } from "@/types/database";
import type { UnitStatus, BusinessType } from "@/types/domain";
import { updateUnitStatus } from "./actions";

interface UnitBusinessFlag {
  business_type: BusinessType; is_enabled: boolean; default_price_xof: number | null;
}

interface AuditLogEntry {
  id: string; action: string; metadata: Record<string, unknown>; created_at: string;
}

interface UnitDetailPanelProps {
  unit: UnitRow; businessFlags: UnitBusinessFlag[]; auditLogs: AuditLogEntry[];
  locale: Locale; onClose: () => void; onStatusChanged: () => void;
}

const manualStatuses: UnitStatus[] = ["available", "maintenance", "locked"];

const inputClass = "w-full rounded-md border border-brand-warm-400 bg-white px-3 py-2.5 text-sm text-brand-ink-900 transition-all duration-fast hover:border-brand-orange-300 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30";
const labelClass = "block text-[10px] font-semibold uppercase tracking-wider text-brand-ink-300 mb-1";

export function UnitDetailPanel({ unit, businessFlags, auditLogs, locale, onClose, onStatusChanged }: UnitDetailPanelProps) {
  const t = dictionaries[locale].units;
  const statusLabels = dictionaries[locale].statuses;
  const [statusOpen, setStatusOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");

  const handleStatusChange = async (newStatus: UnitStatus) => {
    setChanging(true); setError("");
    const result = await updateUnitStatus(unit.id, newStatus);
    setChanging(false);
    if (result.success) { setStatusOpen(false); onStatusChanged(); }
    else setError(result.error ?? "Failed to update status.");
  };

  const enabledBusinesses = businessFlags.filter((f) => f.is_enabled);

  return (
    <>
      <div className="fixed inset-0 z-overlay bg-black/30 backdrop-blur-sm transition-opacity duration-slow" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-panel w-full max-w-md overflow-auto border-l border-brand-warm-400 bg-white shadow-panel" role="dialog" aria-label={t.detail.title}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-warm-400 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-base font-bold text-brand-ink-900">{t.detail.title}</h2>
            <p className="mt-0.5 font-mono text-xs text-brand-ink-300">{unit.code}</p>
          </div>
          <Button variant="icon" size="icon" onClick={onClose} aria-label="关闭">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* Basic info grid */}
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
            {[
              [t.detail.building, "11#公寓"],
              [t.detail.floor, unit.floor_label],
              [t.detail.kind, t.kinds[unit.kind]],
              [t.detail.status, null],
              [t.detail.area, unit.area_sqm != null ? `${Number(unit.area_sqm).toFixed(2)} ${t.detail.areaUnit}` : t.detail.notSet],
              [t.detail.layout, unit.layout ?? t.detail.notSet],
              [t.detail.furnishing, unit.furnishing ? t.furnishing[unit.furnishing] : t.detail.notSet],
              ...(enabledBusinesses.some((f) => f.business_type === "daily_rental")
                ? [[t.detail.dailyPrice, enabledBusinesses.find((f) => f.business_type === "daily_rental")?.default_price_xof ? formatXof(Number(enabledBusinesses.find((f) => f.business_type === "daily_rental")!.default_price_xof)) : t.detail.notSet]]
                : []),
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-brand-ink-300">{label}</dt>
                <dd className="mt-1 font-medium text-brand-ink-900">
                  {label === t.detail.status ? <StatusBadge status={unit.status} locale={locale} /> : (value ?? t.detail.notSet)}
                </dd>
              </div>
            ))}
          </dl>

          {/* Business flags */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-brand-ink-300">{t.detail.supportedBusiness}</h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {enabledBusinesses.length > 0
                ? enabledBusinesses.map((f) => (
                    <span key={f.business_type} className="inline-flex rounded-full bg-brand-orange-50 px-2.5 py-0.5 text-xs font-medium text-brand-orange-600">
                      {t.businessTypes[f.business_type]}
                    </span>
                  ))
                : <span className="text-xs text-brand-ink-300">—</span>}
            </div>
          </div>

          {/* Photos */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-brand-ink-300">{t.detail.photos}</h4>
            <div className="mt-2 flex gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-brand-warm-400 bg-brand-warm-50 text-brand-ink-200">
                  <Camera className="h-6 w-6" />
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-brand-ink-300">{t.detail.notes}</h4>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-ink-500">{unit.notes ?? t.detail.noNotes}</p>
          </div>

          {/* Status change */}
          <div className="relative">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-brand-ink-300">{t.actions.changeStatus}</h4>
            <div className="mt-2">
              <button
                onClick={() => setStatusOpen(!statusOpen)}
                disabled={changing}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand-warm-400 bg-white px-3 text-xs font-medium text-brand-ink-700 transition-all duration-fast hover:bg-brand-warm-50 disabled:opacity-50"
              >
                {t.actions.changeStatus}
                <ChevronDown className={cn("h-3 w-3 transition-transform duration-fast", statusOpen && "rotate-180")} />
              </button>
              {statusOpen && (
                <div className="absolute left-0 top-full z-dropdown mt-1 w-44 rounded-lg border border-brand-warm-400 bg-white py-1 shadow-dropdown">
                  {manualStatuses.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStatusChange(s)}
                      disabled={unit.status === s || changing}
                      className="block w-full px-3 py-2 text-left text-sm text-brand-ink-700 transition-colors duration-fast hover:bg-brand-orange-50 disabled:opacity-40"
                    >
                      {statusLabels[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
          </div>

          {/* Status history */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-brand-ink-300">{t.detail.statusHistory}</h4>
            {auditLogs.length === 0 ? (
              <p className="mt-1.5 text-xs text-brand-ink-300">{t.detail.noStatusHistory}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {auditLogs.map((log) => (
                  <li key={log.id} className="flex items-center justify-between rounded-md bg-brand-warm-50 px-3 py-2 text-xs">
                    <span className="text-brand-ink-500">
                      {statusLabels[log.metadata.previous_status as UnitStatus] ?? "—"}
                      <span className="mx-1 text-brand-ink-300">→</span>
                      {statusLabels[log.metadata.new_status as UnitStatus] ?? "—"}
                    </span>
                    <span className="text-brand-ink-300">
                      {new Date(log.created_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
