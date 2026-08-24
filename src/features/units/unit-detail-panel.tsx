"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { RightDrawer } from "@/components/ui/operational";
import type { UnitRow } from "@/types/database";
import type { UnitStatus, BusinessType } from "@/types/domain";
import { getUnitAuditLogs, updateUnitStatus } from "./actions";
import type { UnitAuditLogEntry } from "./actions";

interface UnitBusinessFlag {
  business_type: BusinessType;
  is_enabled: boolean;
  default_price_xof: number | null;
}

interface UnitDetailPanelProps {
  unit: UnitRow;
  buildingName: string;
  businessFlags: UnitBusinessFlag[];
  locale: Locale;
  onClose: () => void;
  onStatusChanged: () => void;
  canEdit: boolean;
}

const manualStatuses: UnitStatus[] = ["available", "maintenance", "locked"];

export function UnitDetailPanel({ unit, buildingName, businessFlags, locale, onClose, onStatusChanged, canEdit }: UnitDetailPanelProps) {
  const t = dictionaries[locale].units;
  const statusLabels = dictionaries[locale].statuses;
  const [statusOpen, setStatusOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const [auditLogs, setAuditLogs] = useState<UnitAuditLogEntry[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setAuditLogsLoading(true);
    getUnitAuditLogs(unit.id).then((logs) => {
      if (!active) return;
      setAuditLogs(logs);
      setAuditLogsLoading(false);
    });
    return () => { active = false; };
  }, [unit.id]);

  const handleStatusChange = async (newStatus: UnitStatus) => {
    setChanging(true);
    setError("");
    setStatusOpen(false);
    const result = await updateUnitStatus(unit.id, newStatus);
    setChanging(false);
    if (result.success) {
      onStatusChanged();
    } else {
      setError(result.error ?? (locale === "zh" ? "修改房态失败。" : "Échec de la mise à jour du statut."));
    }
  };

  const enabledBusinesses = businessFlags.filter((f) => f.is_enabled);
  const dailyFlag = enabledBusinesses.find((f) => f.business_type === "daily_rental");
  const leaseFlag = enabledBusinesses.find((f) => f.business_type === "long_lease");
  const constructionLabel = unit.construction_status === "operational"
    ? (locale === "zh" ? "可投入使用" : "Opérationnel")
    : unit.construction_status === "unverified"
      ? (locale === "zh" ? "待核实" : "À vérifier")
      : unit.construction_status ?? t.detail.notSet;
  const meaningfulAuditLogs = auditLogs.filter(
    (log) => log.metadata.previous_status !== log.metadata.new_status
  );

  return (
    <RightDrawer open title={t.detail.title} subtitle={`${buildingName} · ${unit.unit_no}`} onClose={onClose}>
        <div className="space-y-5">
          <Button asChild className="w-full">
            <Link href={routeFor(locale, `/units/${unit.id}`)}>
              {locale === "zh" ? "打开完整资产档案" : "Ouvrir le dossier complet"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>

          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
            {[
              [t.detail.building, buildingName],
              [t.detail.floor, unit.floor_label],
              [t.detail.kind, t.kinds[unit.kind]],
              [t.detail.status, null],
              ...(unit.construction_status ? [[locale === "zh" ? "建设状态" : "État de construction", constructionLabel]] : []),
              ...(unit.location_grade ? [[locale === "zh" ? "地段等级" : "Emplacement", unit.location_grade === "central_avenue_prime" ? (locale === "zh" ? "中央大道优质地段" : "Axe central premium") : (locale === "zh" ? "普通地段" : "Standard")]] : []),
              ...(unit.zone_label ? [[locale === "zh" ? "位置分区" : "Zone", unit.zone_label]] : []),
              [t.detail.area, unit.area_sqm != null ? `${Number(unit.area_sqm).toFixed(2)} ${t.detail.areaUnit}` : t.detail.notSet],
              [t.detail.layout, unit.layout ?? t.detail.notSet],
              [t.detail.furnishing, unit.furnishing ? t.furnishing[unit.furnishing] : t.detail.notSet],
              ...(dailyFlag
                ? [[t.detail.dailyPrice, dailyFlag.default_price_xof ? formatXof(Number(dailyFlag.default_price_xof)) : t.detail.notSet]]
                : []),
              ...(leaseFlag
                ? [[locale === "zh" ? "标准月租" : "Loyer mensuel standard", leaseFlag.default_price_xof ? formatXof(Number(leaseFlag.default_price_xof)) : t.detail.notSet]]
                : []),
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-medium">
                  {label === t.detail.status ? <StatusBadge status={unit.status} label={dictionaries[locale].statuses[unit.status]} /> : (value ?? t.detail.notSet)}
                </dd>
              </div>
            ))}
          </dl>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground">{t.detail.supportedBusiness}</h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {enabledBusinesses.length > 0 ? (
                enabledBusinesses.map((f) => (
                  <span key={f.business_type} className="inline-flex rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">{t.businessTypes[f.business_type]}</span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground">{t.detail.notes}</h4>
            <p className="mt-1.5 text-sm leading-relaxed">{unit.notes ?? t.detail.noNotes}</p>
          </div>

          {canEdit && <div className="relative">
            <h4 className="text-xs font-semibold text-muted-foreground">{t.actions.changeStatus}</h4>
            {(unit.occupancy_verified === false || unit.construction_status === "unverified") && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                {locale === "zh"
                  ? "建设和租赁状态尚未核实。只有现场确认已可投入使用后，才能将其开放为可出租资产。"
                  : "La construction et l’occupation ne sont pas vérifiées. Confirmez la mise en service avant d’ouvrir le bien à la location."}
              </p>
            )}
            <div className="mt-2">
              <button onClick={() => setStatusOpen(!statusOpen)} disabled={changing}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50">
                {t.actions.changeStatus}
                <ChevronDown className={cn("h-3 w-3 transition-transform", statusOpen && "rotate-180")} />
              </button>
              {statusOpen && (
                <div className="absolute left-0 top-full z-dropdown mt-1 w-44 rounded-md border bg-card py-1 shadow-md">
                  {manualStatuses.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStatusChange(s)}
                      disabled={unit.status === s || changing}
                      className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-40"
                    >
                      {s === "available" && (unit.occupancy_verified === false || unit.construction_status === "unverified")
                        ? (locale === "zh" ? "确认可投入使用" : "Confirmer la mise en service")
                        : statusLabels[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
          </div>}

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground">{t.detail.statusHistory}</h4>
            {auditLogsLoading ? (
              <p className="mt-1.5 text-xs text-muted-foreground">{locale === "zh" ? "正在读取状态记录…" : "Chargement de l’historique…"}</p>
            ) : meaningfulAuditLogs.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">{t.detail.noStatusHistory}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {meaningfulAuditLogs.map((log) => (
                  <li key={log.id} className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-xs">
                    <span>
                      {statusLabels[log.metadata.previous_status as UnitStatus] ?? "-"}
                      <span className="mx-1 text-muted-foreground">{"->"}</span>
                      {statusLabels[log.metadata.new_status as UnitStatus] ?? "-"}
                    </span>
                    <span className="text-muted-foreground">
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
    </RightDrawer>
  );
}
