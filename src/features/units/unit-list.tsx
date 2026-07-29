"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Building2, ChevronDown, ChevronUp, Home, Key } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, compareFloorLabels, formatXof, sortUnitsForBuilding } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { FilterBar, SegmentedControl } from "@/components/ui/operational";
import { PageHeader } from "@/components/page-header";
import { getUnitOperationalLabel, isOwnerOccupiedUnit } from "@/lib/unit-display";
import { UnitDetailPanel } from "./unit-detail-panel";
import { UnitFilters } from "./unit-filters";
import type { UnitRow, UnitBusinessFlagRow } from "@/types/database";
import type { BusinessType } from "@/types/domain";

interface AuditLogEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface BuildingInfo {
  id: string;
  code: string;
  display_name: string;
}

interface UnitListProps {
  units: UnitRow[];
  businessFlagsMap: Record<string, UnitBusinessFlagRow[]>;
  managedLeaseUnitIds?: string[];
  auditLogsMap: Record<string, AuditLogEntry[]>;
  buildings: BuildingInfo[];
  locale: Locale;
  showHeader?: boolean;
  canEdit: boolean;
}

const STATUS_DOT: Record<string, string> = {
  sold: "bg-[#A0D0E8]",
  leased: "bg-[#5E9BC5]",
  daily_occupied: "bg-[#62B6F5]",
  reserved: "bg-[#E8C840]",
  cleaning_pending: "bg-[#5CC4B8]",
  maintenance: "bg-[#F08090]",
  locked: "bg-gray-400",
  available: "bg-[#B88A48]",
};

const LS_KEY = "sacsi_active_building_id";

export function UnitList({ units, businessFlagsMap, managedLeaseUnitIds = [], auditLogsMap, buildings, locale, showHeader = true, canEdit }: UnitListProps) {
  const router = useRouter();
  const t = dictionaries[locale].units;
  const statusLabels = dictionaries[locale].statuses;
  const [selectedFloor, setSelectedFloor] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedKind, setSelectedKind] = useState("apartment");
  const [selectedBusiness, setSelectedBusiness] = useState("all");
  const [detailUnitId, setDetailUnitId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showNonApartments, setShowNonApartments] = useState(false);

  // Building switcher with localStorage persistence
  const [activeBuildingId, setActiveBuildingId] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && buildings.some((b) => b.id === saved)) {
      setActiveBuildingId(saved);
    } else if (buildings.length > 0) {
      // Default to first building (SACSI7 if available)
      const defaultBld = buildings.find((b) => b.code === "SACSI7") ?? buildings[0];
      setActiveBuildingId(defaultBld.id);
    }
  }, [buildings]);

  const handleBuildingChange = (id: string) => {
    setActiveBuildingId(id);
    localStorage.setItem(LS_KEY, id);
  };

  // Filter units by active building
  const buildingUnits = useMemo(() => {
    if (!activeBuildingId) return [];
    return units.filter((u) => u.building_id === activeBuildingId);
  }, [units, activeBuildingId]);

  const activeBuilding = buildings.find((b) => b.id === activeBuildingId);

  const floors = useMemo(() => {
    const set = new Set(buildingUnits.map((unit) => unit.floor_label));
    return Array.from(set).sort(compareFloorLabels);
  }, [buildingUnits]);

  const filtered = useMemo(() => {
    return buildingUnits.filter((unit) => {
      if (selectedFloor !== "all" && unit.floor_label !== selectedFloor) return false;
      if (selectedStatus !== "all" && unit.status !== selectedStatus) return false;
      if (selectedKind !== "all" && unit.kind !== selectedKind) return false;
      if (selectedBusiness !== "all") {
        const flags = businessFlagsMap[unit.id] ?? [];
        return flags.some((flag) => flag.business_type === selectedBusiness && flag.is_enabled);
      }
      return true;
    });
  }, [buildingUnits, selectedFloor, selectedStatus, selectedKind, selectedBusiness, businessFlagsMap]);

  const apartments = useMemo(() => buildingUnits.filter((unit) => unit.kind === "apartment"), [buildingUnits]);
  const nonApartments = useMemo(() => buildingUnits.filter((unit) => unit.kind !== "apartment"), [buildingUnits]);
  const managedLeaseUnitSet = useMemo(() => new Set(managedLeaseUnitIds), [managedLeaseUnitIds]);

  const summary = useMemo(() => ({
    apartments: apartments.length,
    available: apartments.filter((unit) => unit.status === "available").length,
    daily: apartments.filter((unit) => unit.status === "daily_occupied" || unit.status === "reserved").length,
    leased: apartments.filter((unit) => unit.status === "leased").length,
    managed: apartments.filter((unit) => unit.status === "sold" && managedLeaseUnitSet.has(unit.id)).length,
    sold: apartments.filter((unit) => unit.status === "sold").length,
    ownerOccupied: apartments.filter(isOwnerOccupiedUnit).length,
    maintenance: apartments.filter((unit) => (unit.status === "maintenance" || unit.status === "locked" || unit.status === "cleaning_pending") && !isOwnerOccupiedUnit(unit)).length,
    nonApartment: nonApartments.length,
  }), [apartments, nonApartments, managedLeaseUnitSet]);

  const detailUnit = detailUnitId ? buildingUnits.find((unit) => unit.id === detailUnitId) : null;

  const assetBlocks = [
    { key: "apartments", label: locale === "zh" ? "住宿房源" : "Appartements", value: summary.apartments, dot: "bg-foreground", icon: Home },
    { key: "available", label: statusLabels.available, value: summary.available, dot: "bg-[#B88A48]", icon: undefined },
    { key: "daily", label: locale === "zh" ? "日租/预订" : "Jour", value: summary.daily, dot: "bg-[#5090C0]", icon: undefined },
    { key: "leased", label: statusLabels.leased, value: summary.leased, dot: "bg-[#5E9BC5]", icon: undefined },
    { key: "managed", label: locale === "zh" ? "代管出租" : "Gestion locative", value: summary.managed, dot: "bg-[#36A78F]", icon: undefined },
    { key: "sold", label: statusLabels.sold, value: summary.sold, dot: "bg-[#A0D0E8]", icon: undefined },
    { key: "ownerOccupied", label: locale === "zh" ? "自用" : "Usage interne", value: summary.ownerOccupied, dot: "bg-[#8F8D89]", icon: undefined },
    { key: "maintenance", label: locale === "zh" ? "维护中" : "Maintenance", value: summary.maintenance, dot: "bg-[#F0A080]", icon: AlertTriangle },
    { key: "nonApartment", label: locale === "zh" ? "非住宿" : "Autres", value: summary.nonApartment, dot: "bg-muted-foreground", icon: Key },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Building Switcher */}
      {buildings.length > 1 && (
        <SegmentedControl
          value={activeBuildingId ?? ""}
          onChange={handleBuildingChange}
          ariaLabel={locale === "zh" ? "楼栋切换" : "Selection du batiment"}
          className="self-start"
          items={buildings.map((b) => ({
            value: b.id,
            label: b.display_name || b.code,
          }))}
        />
      )}

      {showHeader && (
      <PageHeader
        title={activeBuilding ? `${activeBuilding.code} ${activeBuilding.display_name}` : (locale === "zh" ? "住宿资产" : "Actifs residentiels")}
        description={`${summary.apartments} ${locale === "zh" ? "套公寓" : "appartements"} · ${locale === "zh" ? "按楼层、状态和业务筛选房源" : "Filtrer par etage, statut et activite"}`}
      />
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        {assetBlocks.filter((block) => ["apartments", "available", "leased", "maintenance"].includes(block.key)).map((block) => {
          const Icon = block.icon;
          const content = (
            <>
              <div className="flex min-w-0 items-center justify-between gap-3 pb-2">
                <p className="min-w-0 truncate text-sm font-medium leading-tight tracking-tight text-foreground">{block.label}</p>
                {Icon ? (
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                ) : (
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", block.dot)} />
                )}
              </div>
              <p className="text-lg font-semibold leading-none tabular-nums text-foreground">{block.value}</p>
            </>
          );

          if (block.key === "nonApartment") {
            return (
              <button
                key={block.key}
                type="button"
                onClick={() => setShowNonApartments(true)}
                className="flex min-h-[76px] flex-col rounded-xl border border-border bg-card p-3 text-left text-card-foreground shadow-card transition-shadow duration-200 hover:shadow-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                {content}
              </button>
            );
          }

          return (
            <div key={block.key} className="flex min-h-[76px] flex-col rounded-xl border border-border bg-card p-3 text-card-foreground shadow-card transition-shadow duration-200">
              {content}
            </div>
          );
        })}
      </div>

      <FilterBar
        meta={`${filtered.length} / ${buildingUnits.length} ${locale === "fr" ? "lots" : "套房源"}`}
      >
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
      </FilterBar>

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
                {sortUnitsForBuilding(filtered, activeBuilding?.code).map((unit) => (
                  <UnitTableRow
                    key={unit.id}
                    unit={unit}
                    locale={locale}
                    flags={businessFlagsMap[unit.id] ?? []}
                    managedLease={managedLeaseUnitSet.has(unit.id)}
                    onOpen={() => setDetailUnitId(unit.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {nonApartments.length > 0 && (
        <div className="rounded-xl border border-border bg-card shadow-card">
          <button
            type="button"
            onClick={() => setShowNonApartments((value) => !value)}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-accent/40"
          >
            <span className="text-sm font-semibold">
              {locale === "zh" ? "非住宿资产" : "Actifs non résidentiels"} · {summary.nonApartment}
            </span>
            {showNonApartments ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {showNonApartments && (
            <div className="table-shell border-t-0 rounded-t-none">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th>{locale === "zh" ? "编号" : "N°"}</th>
                      <th>{locale === "zh" ? "楼层" : "Étage"}</th>
                      <th>{locale === "zh" ? "类型" : "Type"}</th>
                      <th>{locale === "zh" ? "房态" : "Statut"}</th>
                      <th>{locale === "zh" ? "支持业务" : "Activité"}</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortUnitsForBuilding(nonApartments, activeBuilding?.code).map((unit) => (
                      <UnitTableRow
                        key={unit.id}
                        unit={unit}
                        locale={locale}
                        flags={businessFlagsMap[unit.id] ?? []}
                        managedLease={managedLeaseUnitSet.has(unit.id)}
                        onOpen={() => setDetailUnitId(unit.id)}
                        compact
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {detailUnit && (
        <UnitDetailPanel
          key={`${detailUnit.id}-${refreshKey}`}
          unit={detailUnit}
          buildingName={activeBuilding?.display_name ?? activeBuilding?.code ?? "-"}
          businessFlags={businessFlagsMap[detailUnit.id] ?? []}
          auditLogs={auditLogsMap[detailUnit.id] ?? []}
          locale={locale}
          canEdit={canEdit}
          onClose={() => setDetailUnitId(null)}
          onStatusChanged={() => { setRefreshKey((key) => key + 1); router.refresh(); }}
        />
      )}
    </div>
  );
}

function UnitTableRow({
  unit,
  locale,
  flags,
  managedLease,
  onOpen,
  compact = false,
}: {
  unit: UnitRow;
  locale: Locale;
  flags: UnitBusinessFlagRow[];
  managedLease: boolean;
  onOpen: () => void;
  compact?: boolean;
}) {
  const t = dictionaries[locale].units;
  const enabledFlags = flags.filter((flag) => flag.is_enabled);
  const dailyFlag = flags.find((flag) => flag.business_type === "daily_rental" && flag.is_enabled);

  return (
    <tr className="cursor-pointer" onClick={onOpen}>
      <td><span className="font-mono text-xs font-bold">{unit.unit_no}</span></td>
      <td className="text-sm">{unit.floor_label}</td>
      <td className="text-sm text-muted-foreground">{t.kinds[unit.kind]}</td>
      <td><StatusPill unit={unit} locale={locale} managedLease={unit.status === "sold" && managedLease} /></td>
      <td className="text-sm text-muted-foreground">{enabledFlags.map((flag) => t.businessTypes[flag.business_type]).join(" / ") || "-"}</td>
      {!compact && (
        <td className="table-cell-amount">{dailyFlag?.default_price_xof != null ? formatXof(dailyFlag.default_price_xof) : "-"}</td>
      )}
      <td className="table-cell-action">
        <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); onOpen(); }}>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

function StatusPill({ unit, locale, managedLease = false }: { unit: UnitRow; locale: Locale; managedLease?: boolean }) {
  const displayStatus = isOwnerOccupiedUnit(unit) ? "ownerOccupied" : unit.status;
  const label = managedLease
    ? (locale === "zh" ? "已售代管" : "Vendu gere")
    : getUnitOperationalLabel(unit, locale) ?? (dictionaries[locale].statuses as Record<string, string>)[unit.status] ?? unit.status;
  const styles: Record<string, string> = {
    sold: "bg-[#EAF7FF] text-[#17324D] ring-[#C0DDF0]/60",
    leased: "bg-[#DDECF7] text-[#17324D] ring-[#AFCBE1]/70",
    daily_occupied: "bg-[#62B6F5]/10 text-[#1A6090] ring-[#62B6F5]/20",
    reserved: "bg-[#FFF6D8] text-[#17324D] ring-[#E8D5A0]/60",
    cleaning_pending: "bg-[#D9F7F0] text-[#17324D] ring-[#A8E8DB]/60",
    available: "bg-[#EFE1CA] text-[#17324D] ring-[#D8BF98]/70",
    maintenance: "bg-[#FFE2EA] text-[#17324D] ring-[#F5C0CC]/60",
    locked: "bg-muted text-muted-foreground ring-border",
    ownerOccupied: "bg-[#F1F0ED] text-[#17324D] ring-[#D2CFCA]/70",
  };

  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", styles[displayStatus] ?? "")}>
      {label}
    </span>
  );
}
