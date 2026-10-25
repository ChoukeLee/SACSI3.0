import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { compareFloorLabels, sortUnitsForBuilding } from "@/lib/utils";
import type { UnitBusinessFlagRow, UnitRow } from "@/types/database";
import type { UnitPosition } from "./operational-position";
import {
  matchesUnitWorkbenchFilter,
  parseUnitWorkbenchQuery,
  UNIT_WORKBENCH_PAGE_SIZE,
  unitNeedsVerification,
  type UnitWorkbenchBuilding,
  type UnitWorkbenchData,
  type UnitWorkbenchRecord,
  type UnitWorkbenchSearch,
} from "./unit-workbench-model";

type Client = Pick<SupabaseClient, "from">;
type CatalogRow = Pick<
  UnitRow,
  | "id"
  | "building_id"
  | "unit_no"
  | "code"
  | "floor_label"
  | "kind"
  | "construction_status"
  | "occupancy_verified"
> & { unit_business_flags: Pick<UnitBusinessFlagRow, "business_type" | "is_enabled">[] };
type BuildingResult = {
  id: string;
  code: string;
  display_name: string;
  project_id: string;
  project:
    | { code: string; display_name: string; allows_sale: boolean }
    | { code: string; display_name: string; allows_sale: boolean }[]
    | null;
};
const unitColumns =
  "id,building_id,code,unit_no,floor_label,kind,status,area_sqm,layout,furnishing,notes,operational_condition,reservation_holder_name,asset_subtype,construction_status,location_grade,zone_label,occupancy_verified,created_at,updated_at,unit_business_flags(unit_id,business_type,is_enabled,default_price_xof)";
type FullUnit = UnitRow & { unit_business_flags: UnitBusinessFlagRow[] };
const emptySummary = () => ({ occupied: 0, attention: 0, unverified: 0 });

/** Only one building's lightweight index is scanned. Full records are read in 50-ID pages; no contracts, payments or history are read here. */
export async function readUnitWorkbench(
  client: Client,
  input: UnitWorkbenchSearch = {},
  workArea?: "sacsi",
): Promise<UnitWorkbenchData> {
  const query = parseUnitWorkbenchQuery(input);
  const buildingRows = await fetchAllPages<BuildingResult>(
    (from, to) =>
      client
        .from("buildings")
        .select(
          "id,code,display_name,project_id,project:projects!inner(code,display_name,allows_sale)",
          { count: "exact" },
        )
        .eq("is_active", true)
        .eq("project.is_active", true)
        .order("code")
        .order("id")
        .range(from, to),
    "asset building catalogue",
  );
  const buildings = buildingRows.flatMap((row): UnitWorkbenchBuilding[] => {
    const project = Array.isArray(row.project) ? row.project[0] : row.project;
    if (!project || !row.project_id || (workArea === "sacsi" && project.code === "CIMAC"))
      return [];
    return [
      {
        id: row.id,
        code: row.code,
        display_name: row.display_name,
        project_id: row.project_id,
        project_code: project.code,
        project_name: project.display_name,
        allows_sale: project.allows_sale && project.code !== "CIMAC",
      },
    ];
  });
  if (Array.isArray(input.project) || Array.isArray(input.building)) {
    return {
      query,
      buildings,
      building: null,
      scopeUnavailable: true,
      rows: [],
      selected: null,
      selectedUnavailable: !!input.unit,
      floors: [],
      total: 0,
      scopeTotal: 0,
      summary: emptySummary(),
    };
  }
  let selectedUnit: FullUnit | null = null;
  if (query.unit) {
    const { data, error } = await client
      .from("units")
      .select(unitColumns)
      .eq("id", query.unit)
      .maybeSingle();
    if (error) throw new Error("AssetSelectionUnavailable");
    selectedUnit = data as FullUnit | null;
  }
  const projects = new Set(
    buildings
      .filter(
        (row) =>
          !query.project ||
          row.project_id === query.project ||
          row.project_code.toLowerCase() === query.project.toLowerCase(),
      )
      .map((row) => row.project_id),
  );
  const candidates = buildings.filter((row) => projects.has(row.project_id));
  const building = query.building
    ? candidates.find(
        (row) =>
          row.id === query.building || row.code.toLowerCase() === query.building.toLowerCase(),
      )
    : ((selectedUnit ? candidates.find((row) => row.id === selectedUnit.building_id) : undefined) ??
      candidates.find((row) => row.code === "SACSI7") ??
      candidates[0]);
  const scopeUnavailable =
    !building &&
    (!!(query.project || query.building) || (workArea === "sacsi" && !buildings.length));
  const blank: UnitWorkbenchData = {
    query,
    buildings,
    building: building ?? null,
    scopeUnavailable,
    rows: [],
    selected: null,
    selectedUnavailable: !!input.unit,
    floors: [],
    total: 0,
    scopeTotal: 0,
    summary: emptySummary(),
  };
  if (!building) return blank;
  query.project = building.project_id;
  query.building = building.id;
  const [catalogue, positions] = await Promise.all([
    fetchAllPages<CatalogRow>(
      (from, to) =>
        client
          .from("units")
          .select(
            "id,building_id,unit_no,code,floor_label,kind,construction_status,occupancy_verified,unit_business_flags(business_type,is_enabled)",
            { count: "exact" },
          )
          .eq("building_id", building.id)
          .order("unit_no")
          .order("id")
          .range(from, to),
      "asset building index",
    ),
    fetchAllPages<UnitPosition & { id: string; building_id: string }>(
      (from, to) =>
        client
          .from("unit_operational_position")
          .select(
            "id,building_id,ownership,operational_condition,daily_occupied,lease_occupied,cleaning_pending,daily_enabled,lease_enabled",
            { count: "exact" },
          )
          .eq("building_id", building.id)
          .order("id")
          .range(from, to),
      "asset building operational dimensions",
    ),
  ]);
  const positionMap = new Map(positions.map((row) => [row.id, row]));
  const records = catalogue.map((unit) => ({
    unit,
    position: positionMap.get(unit.id) ?? null,
  }));
  const summary = {
    occupied: records.filter(({ position }) => position?.daily_occupied || position?.lease_occupied)
      .length,
    attention: records.filter((row) => matchesUnitWorkbenchFilter(row, "attention")).length,
    unverified: records.filter(unitNeedsVerification).length,
  };
  const needle = query.q.toLocaleLowerCase();
  const filtered = sortUnitsForBuilding(
    catalogue.filter((unit) => {
      const record = { unit, position: positionMap.get(unit.id) ?? null };
      return (
        (!query.floor || unit.floor_label === query.floor) &&
        (!query.kind || unit.kind === query.kind) &&
        (!needle ||
          [unit.unit_no, unit.code, unit.floor_label]
            .join(" ")
            .toLocaleLowerCase()
            .includes(needle)) &&
        (!query.business ||
          ((building.allows_sale || query.business !== "sale") &&
            unit.unit_business_flags.some(
              (flag) => flag.business_type === query.business && flag.is_enabled,
            ))) &&
        matchesUnitWorkbenchFilter(record, query.filter)
      );
    }),
    building.code,
  );
  query.page = Math.min(
    query.page,
    Math.max(1, Math.ceil(filtered.length / UNIT_WORKBENCH_PAGE_SIZE)),
  );
  const ids = filtered
    .slice((query.page - 1) * UNIT_WORKBENCH_PAGE_SIZE, query.page * UNIT_WORKBENCH_PAGE_SIZE)
    .map((row) => row.id);
  let rows: UnitWorkbenchRecord[] = [];
  if (ids.length) {
    const { data, error } = await client
      .from("units")
      .select(unitColumns)
      .eq("building_id", building.id)
      .in("id", ids);
    if (error || !data || data.length !== ids.length) throw new Error("AssetPageUnavailable");
    const byId = new Map((data as FullUnit[]).map((row) => [row.id, row]));
    rows = ids.map((id) => {
      const row = byId.get(id);
      if (!row) throw new Error("AssetPageUnavailable");
      const { unit_business_flags, ...unit } = row;
      return { unit, flags: unit_business_flags ?? [], position: positionMap.get(id) ?? null };
    });
  }
  let selected: UnitWorkbenchRecord | null = null;
  if (
    selectedUnit &&
    selectedUnit.building_id === building.id &&
    catalogue.some((row) => row.id === selectedUnit!.id)
  ) {
    const { unit_business_flags, ...unit } = selectedUnit;
    selected = {
      unit,
      flags: unit_business_flags ?? [],
      position: positionMap.get(unit.id) ?? null,
    };
  }
  // A target in another explicit scope is never substituted with the current occupant or first asset.
  return {
    query,
    buildings,
    building,
    scopeUnavailable: false,
    rows,
    selected,
    selectedUnavailable: !!input.unit && !selected,
    floors: [...new Set(catalogue.map((row) => row.floor_label))].sort(compareFloorLabels),
    total: filtered.length,
    scopeTotal: catalogue.length,
    summary,
  };
}

export async function loadUnitWorkbench(input: UnitWorkbenchSearch = {}) {
  return readUnitWorkbench(await createClient(), input, "sacsi");
}
