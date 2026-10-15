"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownUp, ArrowRight, Building2 } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, compareFloorLabels, formatXof, sortUnitsForBuilding } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { FilterBar, OperationalPage, SegmentedControl } from "@/components/ui/operational";
import { HistoryPagination, useHistoryPage } from "@/features/profiles/history-pagination";
import { UnitDetailPanel } from "./unit-detail-panel";
import { UnitFilters } from "./unit-filters";
import { conditionLabel, matchesUnitPosition, type UnitPosition } from "./operational-position";
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
  positionsMap?: Record<string, UnitPosition>;
  managedLeaseUnitIds?: string[];
  unitPartySummaries?: Record<string, UnitPartySummary>;
  buildings: BuildingInfo[];
  locale: Locale;
  canEdit: boolean;
}

const LS_KEY = "sacsi_active_building_id";

export function UnitList({
  units,
  businessFlagsMap,
  positionsMap = {},
  unitPartySummaries = {},
  buildings,
  locale,
  canEdit,
}: UnitListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = dictionaries[locale].units;
  const zh = locale === "zh";
  const [selectedFloor, setSelectedFloor] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedKind, setSelectedKind] = useState("all");
  const [selectedBusiness, setSelectedBusiness] = useState("all");
  const [search, setSearch] = useState("");
  const [descending, setDescending] = useState(false);
  const [detailUnitId, setDetailUnitId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeBuildingId, setActiveBuildingId] = useState<string | null>(null);
  const requestedBuilding = searchParams.get("building");
  const requestedProject = searchParams.get("project");

  useEffect(() => {
    const deepLinkedBuilding = requestedBuilding
      ? buildings.find((building) => building.code === requestedBuilding)
      : requestedProject
        ? buildings.find(
            (building) =>
              building.project_id === requestedProject ||
              building.project_code.toUpperCase() === requestedProject.toUpperCase(),
          )
        : undefined;
    if ((requestedBuilding || requestedProject) && !deepLinkedBuilding) {
      setActiveBuildingId(null);
      return;
    }
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LS_KEY);
    } catch {
      /* Persistence is optional. */
    }
    const next =
      deepLinkedBuilding ??
      buildings.find((building) => building.id === saved) ??
      buildings.find((building) => building.code === "SACSI7") ??
      buildings[0];
    if (next) setActiveBuildingId(next.id);
  }, [buildings, requestedBuilding, requestedProject]);

  const handleBuildingChange = (id: string) => {
    setActiveBuildingId(id);
    setSelectedFloor("all");
    setSelectedStatus("all");
    setSelectedKind("all");
    setSelectedBusiness("all");
    setSearch("");
    setDetailUnitId(null);
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {
      /* Persistence is optional. */
    }
  };
  const projects = useMemo(() => {
    const seen = new Map<string, { id: string; code: string; name: string }>();
    for (const building of buildings)
      if (!seen.has(building.project_id))
        seen.set(building.project_id, {
          id: building.project_id,
          code: building.project_code,
          name: building.project_name,
        });
    return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [buildings]);
  const activeBuilding = buildings.find((building) => building.id === activeBuildingId);
  const activeProjectId = activeBuilding?.project_id ?? projects[0]?.id ?? "";
  const activeProjectBuildings = buildings.filter(
    (building) => building.project_id === activeProjectId,
  );
  const buildingUnits = useMemo(
    () => units.filter((unit) => unit.building_id === activeBuildingId),
    [units, activeBuildingId],
  );
  const floors = useMemo(
    () => [...new Set(buildingUnits.map((unit) => unit.floor_label))].sort(compareFloorLabels),
    [buildingUnits],
  );
  const filtered = useMemo(
    () =>
      buildingUnits.filter((unit) => {
        if (selectedFloor !== "all" && unit.floor_label !== selectedFloor) return false;
        if (
          !matchesUnitPosition(
            unit,
            positionsMap[unit.id],
            selectedStatus,
            unitPartySummaries[unit.id]?.dailyStatus,
          )
        )
          return false;
        if (selectedKind !== "all" && unit.kind !== selectedKind) return false;
        if (
          selectedBusiness !== "all" &&
          !(businessFlagsMap[unit.id] ?? []).some(
            (flag) => flag.business_type === selectedBusiness && flag.is_enabled,
          )
        )
          return false;
        const party = unitPartySummaries[unit.id];
        return (
          !search.trim() ||
          [
            unit.unit_no,
            unit.code,
            unit.layout,
            unit.notes,
            party?.dailyCustomerName,
            party?.leaseCustomerName,
            party?.saleCustomerName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())
        );
      }),
    [
      buildingUnits,
      positionsMap,
      selectedFloor,
      selectedStatus,
      selectedKind,
      selectedBusiness,
      businessFlagsMap,
      unitPartySummaries,
      search,
    ],
  );
  const sortedUnits = useMemo(() => {
    const sorted = sortUnitsForBuilding(filtered, activeBuilding?.code);
    return descending ? [...sorted].reverse() : sorted;
  }, [filtered, activeBuilding?.code, descending]);
  const history = useHistoryPage(sortedUnits);
  const detailUnit = buildingUnits.find((unit) => unit.id === detailUnitId);
  const isCimac = activeBuilding?.project_code === "CIMAC";
  const unverified = buildingUnits.filter(
    (unit) =>
      unit.occupancy_verified === false ||
      unit.construction_status === "unverified" ||
      !positionsMap[unit.id],
  ).length;
  const missingConfiguration = buildingUnits.filter(
    (unit) => !businessFlagsMap[unit.id]?.length,
  ).length;

  return (
    <OperationalPage
      eyebrow={zh ? "资产主档案" : "Référentiel des actifs"}
      title={activeBuilding?.display_name || activeBuilding?.code || (zh ? "房源" : "Biens")}
      description={
        zh
          ? "以资产为中心，分别查看权属、占用、运行条件与业务配置。"
          : "Propriété, occupation, état opérationnel et activités, sans les confondre."
      }
    >
      {projects.length > 1 && (
        <SegmentedControl
          value={activeProjectId}
          onChange={(id) => {
            const candidates = buildings.filter((building) => building.project_id === id);
            const next = candidates.find((building) => building.code === "SACSI7") ?? candidates[0];
            if (next) handleBuildingChange(next.id);
          }}
          ariaLabel={zh ? "项目切换" : "Sélection du projet"}
          className="self-start"
          items={projects.map((project) => ({ value: project.id, label: project.name }))}
        />
      )}
      {activeProjectBuildings.length > 1 && (
        <SegmentedControl
          value={activeBuildingId ?? ""}
          onChange={handleBuildingChange}
          ariaLabel={zh ? "楼栋切换" : "Sélection du bâtiment"}
          className="self-start"
          items={activeProjectBuildings.map((building) => ({
            value: building.id,
            label: building.display_name || building.code,
          }))}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y py-3 text-sm">
        <span>
          <span className="font-semibold tabular-nums">{buildingUnits.length}</span>{" "}
          {zh ? "项资产" : "actifs"}
        </span>
        <span className={cn(unverified > 0 && "text-amber-700")}>
          <span className="font-semibold tabular-nums">{unverified}</span>{" "}
          {zh ? "项状态待核实" : "états à vérifier"}
        </span>
        <span className={cn(missingConfiguration > 0 && "text-amber-700")}>
          <span className="font-semibold tabular-nums">{missingConfiguration}</span>{" "}
          {zh ? "项业务配置待核对" : "configurations à vérifier"}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {zh
          ? "维度可同时成立：已售资产仍可能长租或待保洁；无当前占用不代表已具备出租条件。价格仅显示数据库配置，不替未配置资产补默认价。"
          : "Les dimensions peuvent coexister : un actif vendu peut être loué ou à nettoyer. L’absence d’occupation ne prouve pas qu’il est prêt à louer. Aucun tarif n’est inventé."}
      </p>
      <FilterBar meta={`${filtered.length} / ${buildingUnits.length} ${zh ? "项资产" : "actifs"}`}>
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
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={zh ? "房号、客户或备注" : "N°, client ou notes"}
          aria-label={zh ? "搜索资产" : "Rechercher un actif"}
          className="w-full sm:w-56"
        />
      </FilterBar>
      {!sortedUnits.length ? (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title={
            !buildingUnits.length
              ? t.empty
              : zh
                ? "没有符合筛选条件的资产"
                : "Aucun actif pour ces filtres"
          }
          description={
            zh
              ? "请确认楼栋与筛选条件；不表示整个项目没有资产。"
              : "Vérifiez le bâtiment et les filtres. Le projet peut contenir d’autres actifs."
          }
        />
      ) : (
        <div data-unit-asset-table className="table-shell">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1220px]">
              <thead>
                <tr>
                  <th aria-sort={descending ? "descending" : "ascending"}>
                    <button
                      className="inline-flex items-center gap-1"
                      onClick={() => setDescending((value) => !value)}
                      aria-label={zh ? "按房号排序" : "Trier par numéro"}
                    >
                      {zh ? "房号 / 类型" : "N° / Type"}
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                  <th>{zh ? "权属" : "Propriété"}</th>
                  <th>{zh ? "业务占用 / 客户" : "Occupation / Client"}</th>
                  <th>{zh ? "运行条件 / 保洁" : "État / Nettoyage"}</th>
                  <th>{zh ? "业务日期" : "Dates"}</th>
                  <th>{zh ? "数据库业务配置 / 默认价" : "Activités / tarifs configurés"}</th>
                  <th>{isCimac ? (zh ? "地段 / 位置" : "Emplacement") : zh ? "备注" : "Notes"}</th>
                  <th className="w-10">
                    <span className="sr-only">{zh ? "操作" : "Actions"}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((unit) => (
                  <UnitTableRow
                    key={unit.id}
                    unit={unit}
                    locale={locale}
                    position={positionsMap[unit.id]}
                    flags={businessFlagsMap[unit.id] ?? []}
                    party={unitPartySummaries[unit.id]}
                    onOpen={() => setDetailUnitId(unit.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <HistoryPagination {...history.pagination} locale={locale} kind="records" />
        </div>
      )}
      {detailUnit && (
        <UnitDetailPanel
          key={`${detailUnit.id}-${refreshKey}`}
          unit={detailUnit}
          position={positionsMap[detailUnit.id]}
          buildingName={activeBuilding?.display_name ?? activeBuilding?.code ?? "—"}
          businessFlags={businessFlagsMap[detailUnit.id] ?? []}
          locale={locale}
          canEdit={canEdit}
          onClose={() => setDetailUnitId(null)}
          onStatusChanged={() => {
            setRefreshKey((key) => key + 1);
            router.refresh();
          }}
        />
      )}
    </OperationalPage>
  );
}

function UnitTableRow({
  unit,
  locale,
  position,
  flags,
  party,
  onOpen,
}: {
  unit: UnitRow;
  locale: Locale;
  position?: UnitPosition;
  flags: UnitBusinessFlagRow[];
  party?: UnitPartySummary;
  onOpen: () => void;
}) {
  const zh = locale === "zh";
  const t = dictionaries[locale].units;
  const enabled = flags.filter((flag) => flag.is_enabled);
  return (
    <tr className="cursor-pointer" onClick={onOpen}>
      <td>
        <span className="font-mono text-sm font-semibold">{unit.unit_no}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {unit.floor_label} · {t.kinds[unit.kind]}
        </span>
      </td>
      <td className="text-sm">
        {position?.ownership === "sold"
          ? zh
            ? "已售"
            : "Vendu"
          : zh
            ? "权属未明确"
            : "Propriété non précisée"}
      </td>
      <td className="text-sm">
        <div className="space-y-1">
          {position?.lease_occupied && (
            <div>
              <span className="font-medium">{zh ? "长租" : "Bail"}</span> ·{" "}
              {party?.leaseCustomerName || (zh ? "客户待补" : "Client à compléter")}
            </div>
          )}
          {position?.daily_occupied && (
            <div>
              <span className="font-medium">{zh ? "日租入住" : "Séjour"}</span> ·{" "}
              {party?.dailyCustomerName || (zh ? "住客待补" : "Client à compléter")}
            </div>
          )}
          {party?.dailyStatus === "confirmed" && (
            <div className="text-amber-700">
              {zh ? "日租预订（未入住）" : "Réservation (non arrivée)"} ·{" "}
              {party.dailyCustomerName || "—"}
            </div>
          )}
          {position &&
            !position.daily_occupied &&
            !position.lease_occupied &&
            party?.dailyStatus !== "confirmed" && (
              <span className="text-muted-foreground">
                {zh ? "无当前占用" : "Aucune occupation actuelle"}
              </span>
            )}
          {!position && (
            <span className="text-amber-700">
              {zh ? "占用维度待核实" : "Occupation à vérifier"}
            </span>
          )}
          {position?.ownership === "sold" && party?.saleCustomerName && (
            <span className="block text-xs text-muted-foreground">
              {zh ? "购买客户" : "Acquéreur"} · {party.saleCustomerName}
            </span>
          )}
        </div>
      </td>
      <td className="text-sm">
        <span className={cn(position?.operational_condition !== "normal" && "text-amber-700")}>
          {conditionLabel(position?.operational_condition, locale)}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {!position
            ? zh
              ? "保洁待核实"
              : "Nettoyage à vérifier"
            : position.cleaning_pending
              ? zh
                ? "待保洁"
                : "À nettoyer"
              : zh
                ? "无待办保洁"
                : "Aucun nettoyage en attente"}
        </span>
        {(unit.occupancy_verified === false || unit.construction_status === "unverified") && (
          <span className="mt-1 block text-xs text-amber-700">
            {zh ? "使用条件未核实" : "Mise en service à vérifier"}
          </span>
        )}
      </td>
      <td className="text-sm text-muted-foreground">
        <div className="space-y-1">
          {position?.lease_occupied && (
            <div>
              {zh ? "合同到期" : "Fin de bail"} ·{" "}
              {party?.leaseEndConfirmed === false
                ? zh
                  ? "未确认"
                  : "Non confirmée"
                : (party?.leaseEndDate ?? "—")}
            </div>
          )}
          {(position?.daily_occupied || party?.dailyStatus === "confirmed") && (
            <div>{party?.dailyDateText?.replace("未定", zh ? "未定" : "Ouvert") ?? "—"}</div>
          )}
          {!position?.lease_occupied &&
            !position?.daily_occupied &&
            party?.dailyStatus !== "confirmed" &&
            "—"}
        </div>
      </td>
      <td className="text-sm text-muted-foreground">
        {!flags.length ? (
          <span className="text-amber-700">
            {zh ? "业务配置待核对" : "Configuration à vérifier"}
          </span>
        ) : !enabled.length ? (
          zh ? (
            "业务均未启用"
          ) : (
            "Aucune activité activée"
          )
        ) : (
          <div className="space-y-1">
            {enabled.map((flag) => (
              <div key={flag.business_type}>
                <span>{t.businessTypes[flag.business_type]}</span>
                <span className="ml-2 tabular-nums">
                  {flag.default_price_xof == null
                    ? zh
                      ? "未配置价格"
                      : "Tarif non renseigné"
                    : formatXof(flag.default_price_xof)}
                </span>
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="max-w-56 text-sm text-muted-foreground">
        {unit.location_grade ? (
          <div>
            <span>
              {unit.location_grade === "central_avenue_prime"
                ? zh
                  ? "中央大道优质地段"
                  : "Axe central premium"
                : zh
                  ? "普通地段"
                  : "Standard"}
            </span>
            <span className="mt-1 block text-xs">{unit.zone_label || "—"}</span>
          </div>
        ) : (
          <span className="line-clamp-2" title={unit.notes ?? undefined}>
            {unit.notes || "—"}
          </span>
        )}
      </td>
      <td className="table-cell-action">
        <Button
          size="sm"
          variant="ghost"
          aria-label={zh ? `查看资产 ${unit.unit_no}` : `Voir l’actif ${unit.unit_no}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}
