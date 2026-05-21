"use client";

import { useState } from "react";
import Link from "next/link";
import { X, Camera, ChevronDown } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { UnitRow } from "@/types/database";
import type { UnitStatus, BusinessType } from "@/types/domain";
import { updateUnitStatus } from "./actions";

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

interface UnitDetailPanelProps {
  unit: UnitRow;
  businessFlags: UnitBusinessFlag[];
  auditLogs: AuditLogEntry[];
  locale: Locale;
  onClose: () => void;
  onStatusChanged: () => void;
}

const manualStatuses: UnitStatus[] = ["available", "maintenance", "locked"];

export function UnitDetailPanel({ unit, businessFlags, auditLogs, locale, onClose, onStatusChanged }: UnitDetailPanelProps) {
  const t = dictionaries[locale].units;
  const statusLabels = dictionaries[locale].statuses;
  const [statusOpen, setStatusOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");

  const handleStatusChange = async (newStatus: UnitStatus) => {
    setChanging(true);
    setError("");
    const result = await updateUnitStatus(unit.id, newStatus);
    setChanging(false);
    if (result.success) {
      setStatusOpen(false);
      onStatusChanged();
    } else {
      setError(result.error ?? "Failed to update status.");
    }
  };

  const enabledBusinesses = businessFlags.filter((f) => f.is_enabled);
  const dailyFlag = enabledBusinesses.find((f) => f.business_type === "daily_rental");

  return (
    <>
      <div className="fixed inset-0 z-overlay bg-black/30 backdrop-blur-sm transition-opacity duration-slow" onClick={onClose} />
      <div
        className="fixed inset-y-0 right-0 z-panel w-full max-w-md overflow-auto border-l border-slate-200 bg-white shadow-panel"
        role="dialog"
        aria-label={t.detail.title}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-sm font-black text-slate-950">{t.detail.title}</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-400">{unit.code}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={routeFor(locale, `/units/${unit.id}`)}
              className="inline-flex h-9 items-center rounded-xl bg-brand-orange-500 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-brand-orange-600"
            >
              {locale === "zh" ? "完整档案" : "Dossier"}
            </Link>
            <Button variant="icon" size="icon" onClick={onClose} aria-label={locale === "zh" ? "关闭" : "Fermer"}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
            {[
              [t.detail.building, "11#公寓"],
              [t.detail.floor, unit.floor_label],
              [t.detail.kind, t.kinds[unit.kind]],
              [t.detail.status, null],
              [t.detail.area, unit.area_sqm != null ? `${Number(unit.area_sqm).toFixed(2)} ${t.detail.areaUnit}` : t.detail.notSet],
              [t.detail.layout, unit.layout ?? t.detail.notSet],
              [t.detail.furnishing, unit.furnishing ? t.furnishing[unit.furnishing] : t.detail.notSet],
              ...(dailyFlag
                ? [[t.detail.dailyPrice, dailyFlag.default_price_xof ? formatXof(Number(dailyFlag.default_price_xof)) : t.detail.notSet]]
                : []),
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</dt>
                <dd className="mt-1 font-medium text-slate-950">
                  {label === t.detail.status ? <StatusBadge status={unit.status} labels={dictionaries[locale].statuses} /> : (value ?? t.detail.notSet)}
                </dd>
              </div>
            ))}
          </dl>

          <div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{t.detail.supportedBusiness}</h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {enabledBusinesses.length > 0 ? (
                enabledBusinesses.map((f) => (
                  <span key={f.business_type} className="inline-flex rounded-full bg-brand-orange-50 px-2.5 py-0.5 text-xs font-semibold text-brand-orange-600">
                    {t.businessTypes[f.business_type]}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400">-</span>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{t.detail.photos}</h4>
            <div className="mt-2 flex gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-300">
                  <Camera className="h-6 w-6" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{t.detail.notes}</h4>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{unit.notes ?? t.detail.noNotes}</p>
          </div>

          <div className="relative">
            <h4 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{t.actions.changeStatus}</h4>
            <div className="mt-2">
              <button
                onClick={() => setStatusOpen(!statusOpen)}
                disabled={changing}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 transition-all duration-fast hover:bg-slate-50 disabled:opacity-50"
              >
                {t.actions.changeStatus}
                <ChevronDown className={cn("h-3 w-3 transition-transform duration-fast", statusOpen && "rotate-180")} />
              </button>
              {statusOpen && (
                <div className="absolute left-0 top-full z-dropdown mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-dropdown">
                  {manualStatuses.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStatusChange(s)}
                      disabled={unit.status === s || changing}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-800 transition-colors duration-fast hover:bg-brand-orange-50 disabled:opacity-40"
                    >
                      {statusLabels[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
          </div>

          <div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{t.detail.statusHistory}</h4>
            {auditLogs.length === 0 ? (
              <p className="mt-1.5 text-xs text-slate-400">{t.detail.noStatusHistory}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {auditLogs.map((log) => (
                  <li key={log.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs">
                    <span className="text-slate-600">
                      {statusLabels[log.metadata.previous_status as UnitStatus] ?? "-"}
                      <span className="mx-1 text-slate-400">{"->"}</span>
                      {statusLabels[log.metadata.new_status as UnitStatus] ?? "-"}
                    </span>
                    <span className="text-slate-400">
                      {new Date(log.created_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
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
