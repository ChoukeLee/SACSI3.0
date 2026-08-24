"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, Building2, Home, Key, MapPin } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, compareFloorLabels, formatXof, sortUnitsForBuilding } from "@/lib/utils";
import { statusDisplayLabel } from "@/lib/display-labels";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { FilterBar, MetricGrid, OperationalPage, SegmentedControl, StatTile } from "@/components/ui/operational";
import { getUnitOperationalLabel, isOwnerOccupiedUnit } from "@/lib/unit-display";
import { UnitDetailPanel } from "./unit-detail-panel";
import { UnitFilters } from "./unit-filters";
import type { UnitRow, UnitBusinessFlagRow } from "@/types/database";
import type { UnitPartySummary } from "./unit-party-summary";

interface BuildingInfo {
  id: string;
  code: string;
  display_name: string;
  project_id: string;
  project_code: string;
  project_name: string;
}

interface UnitListProps {
  units: UnitRow[];
  businessFlagsMap: Record<string, UnitBusinessFlagRow[]>;
  managedLeaseUnitIds?: string[];
  unitPartySummaries?: Record<string, UnitPartySummary>;
  buildings: BuildingInfo[];
  locale: Locale;
  canEdit: boolean;
}

const LS_KEY = "sacsi_active_building_id";

export function UnitList({ units, businessFlagsMap, managedLeaseUnitIds = [], unitPartySummaries = {}, buildings, locale, canEdit }: UnitListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = dictionaries[locale].units;
  const statusLabels = dictionaries[locale].statuses;
  const [selectedFloor, setSelectedFloor] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedKind, setSelectedKind] = useState("all");
  const [selectedBusiness, setSelectedBusiness] = useState("all");
  const [detailUnitId, setDetailUnitId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Building switcher with localStorage persistence
  const [activeBuildingId, setActiveBuildingId] = useState<string | null>(null);

  useEffect(() => {
    const requestedBuilding = searchParams.get("building");
    const requestedProject = searchParams.get("project")?.toUpperCase();
    const deepLinkedBuilding = requestedBuilding
      ? buildings.find((building) => building.code === requestedBuilding)
      : requestedProject
        ? buildings.find((building) => building.project_code === requestedProject)
        : undefined;
    if (deepLinkedBuilding) {
      setActiveBuildingId(deepLinkedBuilding.id);
      localStorage.setItem(LS_KEY, deepLinkedBuilding.id);
      return;
    }
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

  const projects = useMemo(() => {
    const seen = new Map<string, { id: string; code: string; name: string }>();
    for (const building of buildings) {
      if (!seen.has(building.project_id)) {
        seen.set(building.project_id, {
          id: building.project_id,
          code: building.project_code,
          name: building.project_name,
        });
      }
    }
    return Array.from(seen.values()).sort((left, right) => left.code.localeCompare(right.code));
  }, [buildings, searchParams]);

  // Filter units by active building
  const buildingUnits = useMemo(() => {
    if (!activeBuildingId) return [];
    return units.filter((u) => u.building_id === activeBuildingId);
  }, [units, activeBuildingId]);

  const activeBuilding = buildings.find((b) => b.id === activeBuildingId);
  const activeProjectId = activeBuilding?.project_id ?? projects[0]?.id ?? "";
  const activeProjectBuildings = useMemo(
    () => buildings.filter((building) => building.project_id === activeProjectId),
    [activeProjectId, buildings],
  );
  const handleProjectChange = (projectId: string) => {
    const candidates = buildings.filter((building) => building.project_id === projectId);
    const next = candidates.find((building) => building.code === "SACSI7") ?? candidates[0];
    if (next) handleBuildingChange(next.id);
  };

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
    unverified: buildingUnits.filter((unit) => unit.occupancy_verified === false || unit.construction_status === "unverified").length,
    prime: buildingUnits.filter((unit) => unit.location_grade === "central_avenue_prime").length,
    standard: buildingUnits.filter((unit) => unit.location_grade === "standard").length,
  }), [apartments, buildingUnits, nonApartments, managedLeaseUnitSet]);

  const detailUnit = detailUnitId ? buildingUnits.find((unit) => unit.id === detailUnitId) : null;

  const sortedUnits = useMemo(
    () => sortUnitsForBuilding(filtered, activeBuilding?.code),
    [activeBuilding?.code, filtered],
  );

  const isCimac = activeBuilding?.project_code === "CIMAC";
  const assetBlocks = isCimac ? [
    { key: "shops", label: locale === "zh" ? "商业区商铺" : "Commerces", value: buildingUnits.length, dot: "bg-foreground", icon: Building2 },
    { key: "unverified", label: locale === "zh" ? "状态待核实" : "À vérifier", value: summary.unverified, dot: "bg-muted-foreground", icon: AlertTriangle },
    { key: "prime", label: locale === "zh" ? "优质地段" : "Emplacement premium", value: summary.prime, dot: "bg-[#D97706]", icon: MapPin },
    { key: "standard", label: locale === "zh" ? "普通地段" : "Emplacement standard", value: summary.standard, dot: "bg-[#94A3B8]", icon: undefined },
  ] : [
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
    <OperationalPage
      eyebrow={locale === "zh" ? "房源管理" : "Gestion des biens"}
      title={activeBuilding ? `${activeBuilding.display_name || activeBuilding.code}` : (locale === "zh" ? "房源" : "Biens")}
      description={locale === "zh"
        ? `${buildingUnits.length} 项资产 · 筛选、查看并维护房源档案`
        : `${buildingUnits.length} actifs · filtrer, consulter et maintenir les dossiers`}
    >
      {projects.length > 1 && (
        <SegmentedControl
          value={activeProjectId}
          onChange={handleProjectChange}
          ariaLabel={locale === "zh" ? "项目切换" : "Sélection du projet"}
          className="self-start"
          items={projects.map((project) => ({ value: project.id, label: project.name }))}
        />
      )}

      {/* Building Switcher */}
      {activeProjectBuildings.length > 1 && (
        <SegmentedControl
          value={activeBuildingId ?? ""}
          onChange={handleBuildingChange}
          ariaLabel={locale === "zh" ? "楼栋切换" : "Selection du batiment"}
          className="self-start"
          items={activeProjectBuildings.map((b) => ({
            value: b.id,
            label: b.display_name || b.code,
          }))}
        />
      )}

      <MetricGrid columns={4}>
        {assetBlocks.filter((block) => isCimac || ["apartments", "available", "leased", "maintenance"].includes(block.key)).map((block) => {
          const Icon = block.icon;
          const tone = block.key === "available" ? "sold" : block.key === "leased" ? "leased" : block.key === "maintenance" ? "red" : block.key === "prime" ? "amber" : "neutral";
          return (
            <StatTile
              key={block.key}
              label={block.label}
              value={block.value}
              tone={tone}
              icon={Icon}
            />
          );
        })}
      </MetricGrid>

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

      {sortedUnits.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title={buildingUnits.length === 0 ? t.empty : (locale === "zh" ? "没有符合筛选条件的房源" : "Aucun bien ne correspond aux filtres")}
          description={buildingUnits.length === 0
            ? (locale === "zh" ? "请先在设置中导入楼栋和房间" : "Importez d'abord l'immeuble dans Paramètres")
            : (locale === "zh" ? "请调整楼层、房态、类型或业务筛选" : "Modifiez les filtres d'étage, de statut, de type ou d'activité")}
        />
      ) : (
        <div data-unit-asset-table className="table-shell">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px]">
              <thead>
                <tr>
                  <th>{locale === "zh" ? "房号" : "N°"}</th>
                  <th>{locale === "zh" ? "楼层" : "Étage"}</th>
                  <th>{locale === "zh" ? "类型" : "Type"}</th>
                  <th>{locale === "zh" ? "房态" : "Statut"}</th>
                  <th>{locale === "zh" ? "当前客户" : "Client actuel"}</th>
                  <th>{locale === "zh" ? "业务日期" : "Date d'activité"}</th>
                  <th>{locale === "zh" ? "支持业务 / 默认价" : "Activité / tarif"}</th>
                  <th>{isCimac ? (locale === "zh" ? "地段 / 位置" : "Emplacement") : (locale === "zh" ? "备注" : "Notes")}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {sortedUnits.map((unit) => (
                  <UnitTableRow
                    key={unit.id}
                    unit={unit}
                    locale={locale}
                    flags={businessFlagsMap[unit.id] ?? []}
                    managedLease={managedLeaseUnitSet.has(unit.id)}
                    party={unitPartySummaries[unit.id]}
                    onOpen={() => setDetailUnitId(unit.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailUnit && (
        <UnitDetailPanel
          key={`${detailUnit.id}-${refreshKey}`}
          unit={detailUnit}
          buildingName={activeBuilding?.display_name ?? activeBuilding?.code ?? "-"}
          businessFlags={businessFlagsMap[detailUnit.id] ?? []}
          locale={locale}
          canEdit={canEdit}
          onClose={() => setDetailUnitId(null)}
          onStatusChanged={() => { setRefreshKey((key) => key + 1); router.refresh(); }}
        />
      )}
    </OperationalPage>
  );
}

function UnitTableRow({
  unit,
  locale,
  flags,
  managedLease,
  party,
  onOpen,
}: {
  unit: UnitRow;
  locale: Locale;
  flags: UnitBusinessFlagRow[];
  managedLease: boolean;
  party?: UnitPartySummary;
  onOpen: () => void;
}) {
  const t = dictionaries[locale].units;
  const enabledFlags = flags.filter((flag) => flag.is_enabled);
  const priceFlag = enabledFlags.find((flag) => flag.business_type === "daily_rental")
    ?? enabledFlags.find((flag) => flag.business_type === "long_lease");
  const isManagedLease = unit.status === "sold" && managedLease;
  const customerName = unit.status === "daily_occupied" || unit.status === "reserved"
    ? party?.dailyCustomerName
    : unit.status === "leased" || isManagedLease
      ? party?.leaseCustomerName
      : unit.status === "sold" ? party?.saleCustomerName : undefined;
  const businessDate = unit.status === "leased" || isManagedLease
    ? party?.leaseEndDate
      ? `${locale === "zh" ? "到期" : "Fin"} ${party.leaseEndConfirmed === false ? (locale === "zh" ? "未确认" : "non confirmée") : party.leaseEndDate}`
      : "—"
    : unit.status === "daily_occupied" || unit.status === "reserved" ? party?.dailyDateText ?? "—" : "—";

  return (
    <tr className="cursor-pointer" onClick={onOpen}>
      <td><span className="font-mono text-xs font-bold">{unit.unit_no}</span></td>
      <td className="text-sm">{unit.floor_label}</td>
      <td className="text-sm text-muted-foreground">{t.kinds[unit.kind]}</td>
      <td><StatusPill unit={unit} locale={locale} managedLease={isManagedLease} /></td>
      <td className="max-w-48 truncate text-sm font-medium" title={customerName}>{customerName || "—"}</td>
      <td className="whitespace-nowrap text-sm text-muted-foreground">{businessDate}</td>
      <td className="text-sm text-muted-foreground">
        <div>{enabledFlags.map((flag) => t.businessTypes[flag.business_type]).join(" / ") || "—"}</div>
        {priceFlag?.default_price_xof != null && <div className="mt-0.5 text-xs tabular-nums">{formatXof(priceFlag.default_price_xof)}</div>}
      </td>
      <td className="max-w-56 text-sm text-muted-foreground">
        {unit.location_grade ? (
          <div className="flex flex-col gap-0.5">
            <span className={cn("font-medium", unit.location_grade === "central_avenue_prime" && "text-amber-700")}>{unit.location_grade === "central_avenue_prime" ? (locale === "zh" ? "中央大道优质地段" : "Axe central premium") : (locale === "zh" ? "普通地段" : "Standard")}</span>
            <span className="text-xs">{unit.zone_label || "—"}</span>
          </div>
        ) : <span className="block truncate" title={unit.notes ?? undefined}>{unit.notes || "—"}</span>}
      </td>
      <td className="table-cell-action">
        <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); onOpen(); }}>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

function StatusPill({ unit, locale, managedLease = false }: { unit: UnitRow; locale: Locale; managedLease?: boolean }) {
  const pendingVerification = unit.occupancy_verified === false || unit.construction_status === "unverified";
  const displayStatus = isOwnerOccupiedUnit(unit) ? "ownerOccupied" : unit.status;
  const label = pendingVerification
    ? (locale === "zh" ? "待核实" : "À vérifier")
    : managedLease
    ? (locale === "zh" ? "已售代管" : "Vendu gere")
    : getUnitOperationalLabel(unit, locale) ?? (dictionaries[locale].statuses as Record<string, string>)[unit.status] ?? statusDisplayLabel(unit.status, locale);
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
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", pendingVerification ? "bg-muted text-muted-foreground ring-border" : styles[displayStatus] ?? "")}>
      {label}
    </span>
  );
}
