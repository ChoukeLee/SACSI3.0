import type { UnitKind } from "@/types/domain";
import type { UnitPosition } from "@/features/units/operational-position";
import type {
  CimacAssetCounts,
  CimacAssetSummary,
  CimacWorkspaceScope,
  CimacWorkspaceQuery,
} from "./cimac-workspace-types";
import { CimacWorkspaceReadError } from "./cimac-workspace-types";
import { cimacWorkspaceId } from "./cimac-workspace-query";

type Row = Record<string, unknown>;
const fail = (): never => {
  throw new CimacWorkspaceReadError();
};
export const cimacAssetKinds = [
  "apartment",
  "parking",
  "storefront",
  "office",
  "warehouse",
] as const;
const construction = [
  "planned",
  "under_construction",
  "inspection_pending",
  "fitout_pending",
  "partially_operational",
  "operational",
  "paused",
  "unverified",
];
export function cimacWorkspaceObject(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Row;
}
const text = (value: unknown, empty = false): string =>
  typeof value === "string" && (empty || value.trim().length > 0) && value.length <= 2000
    ? value
    : fail();
const nullableText = (value: unknown) =>
  value === undefined || value === null ? null : text(value);
const id = (value: unknown) => {
  try {
    return cimacWorkspaceId(value);
  } catch {
    return fail();
  }
};
export function assertCimacWorkspaceScope(scope: CimacWorkspaceScope): void {
  if (
    !scope ||
    scope.project?.code !== "CIMAC" ||
    !Array.isArray(scope.buildings) ||
    scope.buildings.length > 1000
  )
    throw new CimacWorkspaceReadError(403);
  id(scope.project.id);
  text(scope.project.displayName);
  const seen = new Set<string>();
  for (const b of scope.buildings) {
    const key = id(b.id);
    if (seen.has(key) || typeof b.isActive !== "boolean") return fail();
    seen.add(key);
    text(b.code);
    text(b.name);
    if (b.constructionStatus !== null && !construction.includes(b.constructionStatus))
      return fail();
  }
}
export function assertCimacWorkspaceQuery(
  scope: CimacWorkspaceScope,
  query: CimacWorkspaceQuery,
): void {
  assertCimacWorkspaceScope(scope);
  if (
    (query.project !== "CIMAC" && query.project !== scope.project.id) ||
    (query.building && !scope.buildings.some((b) => b.id === query.building))
  )
    throw new CimacWorkspaceReadError(403);
}
export function decodeCimacWorkspaceScope(
  projectValue: unknown,
  buildingValues: unknown[],
): CimacWorkspaceScope {
  const p = cimacWorkspaceObject(projectValue);
  if (p.code !== "CIMAC") throw new CimacWorkspaceReadError(403);
  const project = { id: id(p.id), code: "CIMAC" as const, displayName: text(p.display_name) };
  const buildings = buildingValues.map((raw) => {
    const b = cimacWorkspaceObject(raw),
      status = nullableText(b.construction_status);
    if (
      b.project_id !== project.id ||
      typeof b.is_active !== "boolean" ||
      (status !== null && !construction.includes(status))
    )
      return fail();
    return {
      id: id(b.id),
      code: text(b.code),
      name: text(b.display_name),
      constructionStatus: status,
      isActive: b.is_active,
    };
  });
  const scope = { project, buildings };
  assertCimacWorkspaceScope(scope);
  return scope;
}
export function decodeCimacPosition(
  value: unknown,
  unitId: string,
  buildingId: string,
): UnitPosition {
  const row = cimacWorkspaceObject(value);
  const leaseStart = row.lease_start_date;
  if (
    row.id !== unitId ||
    row.building_id !== buildingId ||
    !["sold", "unspecified"].includes(String(row.ownership)) ||
    !["normal", "maintenance", "locked"].includes(String(row.operational_condition)) ||
    ["daily_occupied", "lease_occupied", "cleaning_pending", "daily_enabled", "lease_enabled"].some(
      (k) => typeof row[k] !== "boolean",
    ) ||
    (row.lease_pending !== undefined && typeof row.lease_pending !== "boolean") ||
    (leaseStart !== undefined &&
      leaseStart !== null &&
      (typeof leaseStart !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(leaseStart) ||
        !Number.isFinite(Date.parse(leaseStart)) ||
        new Date(`${leaseStart}T00:00:00Z`).toISOString().slice(0, 10) !== leaseStart))
  )
    return fail();
  return {
    id: unitId,
    ownership: row.ownership as UnitPosition["ownership"],
    operational_condition: String(row.operational_condition),
    daily_occupied: row.daily_occupied as boolean,
    lease_occupied: row.lease_occupied as boolean,
    lease_pending: row.lease_pending as boolean | undefined,
    lease_start_date: (leaseStart as string | null | undefined) ?? null,
    cleaning_pending: row.cleaning_pending as boolean,
    daily_enabled: row.daily_enabled as boolean,
    lease_enabled: row.lease_enabled as boolean,
  };
}
export function decodeCimacAsset(
  scope: CimacWorkspaceScope,
  value: unknown,
  positionValue: unknown | null,
): CimacAssetSummary {
  assertCimacWorkspaceScope(scope);
  const row = cimacWorkspaceObject(value),
    unitId = id(row.id),
    building = scope.buildings.find((b) => b.id === row.building_id);
  if (!building) throw new CimacWorkspaceReadError(404);
  const status = nullableText(row.construction_status),
    verified = row.occupancy_verified ?? null;
  if (
    !cimacAssetKinds.includes(row.kind as UnitKind) ||
    (status !== null && !construction.includes(status)) ||
    (verified !== null && typeof verified !== "boolean")
  )
    return fail();
  const area =
    row.area_sqm === null
      ? null
      : (typeof row.area_sqm === "number" || typeof row.area_sqm === "string") &&
          /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(String(row.area_sqm)) &&
          Number.isFinite(Number(row.area_sqm)) &&
          Number(row.area_sqm) <= 1e12
        ? Number(row.area_sqm)
        : fail();
  const updatedAt =
    row.updated_at === undefined || row.updated_at === null ? null : text(row.updated_at);
  if (
    updatedAt &&
    (!/^\d{4}-\d{2}-\d{2}T/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt)))
  )
    return fail();
  const position =
    positionValue === null ? null : decodeCimacPosition(positionValue, unitId, building.id);
  const attentionReasons: CimacAssetSummary["attentionReasons"] = [];
  if (!status || status === "unverified") attentionReasons.push("construction_unverified");
  else if (status !== "operational") attentionReasons.push("construction_pending");
  if (verified !== true || !position) attentionReasons.push("occupancy_unverified");
  if (position?.operational_condition === "maintenance") attentionReasons.push("maintenance");
  if (position?.operational_condition === "locked") attentionReasons.push("locked");
  return {
    id: unitId,
    code: text(row.code),
    unitNo: text(row.unit_no),
    kind: row.kind as UnitKind,
    assetSubtype: nullableText(row.asset_subtype),
    buildingId: building.id,
    buildingName: building.name,
    buildingCode: building.code,
    floorLabel: text(row.floor_label, true),
    areaSqm: area,
    updatedAt,
    constructionStatus: status,
    occupancyVerified: verified,
    position,
    attentionReasons,
    handover: { status: "unknown", date: null },
    opening: { status: "unknown", date: null },
  };
}
export function cimacAssetCounts(assets: CimacAssetSummary[]): CimacAssetCounts {
  const byKind: Record<UnitKind, number> = {
    apartment: 0,
    parking: 0,
    storefront: 0,
    office: 0,
    warehouse: 0,
  };
  let occupied = 0,
    unoccupied = 0,
    occupancyUnknown = 0;
  for (const a of assets) {
    byKind[a.kind]++;
    if (a.occupancyVerified !== true || !a.position) occupancyUnknown++;
    else if (a.position.daily_occupied || a.position.lease_occupied) occupied++;
    else unoccupied++;
  }
  return {
    total: assets.length,
    occupied,
    unoccupied,
    occupancyUnknown,
    constructionUnknown: assets.filter((a) =>
      a.attentionReasons.includes("construction_unverified"),
    ).length,
    constructionPending: assets.filter((a) => a.attentionReasons.includes("construction_pending"))
      .length,
    maintenance: assets.filter((a) => a.attentionReasons.includes("maintenance")).length,
    locked: assets.filter((a) => a.attentionReasons.includes("locked")).length,
    byKind,
  };
}
export function filterCimacAssets(
  assets: CimacAssetSummary[],
  query: CimacWorkspaceQuery,
): CimacAssetSummary[] {
  const q = query.q.toLocaleLowerCase();
  return assets
    .filter((a) => !query.building || a.buildingId === query.building)
    .filter((a) => !query.kind || a.kind === query.kind)
    .filter(
      (a) =>
        !q ||
        [a.code, a.unitNo, a.buildingName, a.buildingCode, a.floorLabel]
          .join(" ")
          .toLocaleLowerCase()
          .includes(q),
    )
    .filter(
      (a) =>
        query.filter === "all" ||
        (query.filter === "attention" && a.attentionReasons.length > 0) ||
        (query.filter === "occupied" &&
          a.occupancyVerified === true &&
          a.position &&
          (a.position.lease_occupied || a.position.daily_occupied)) ||
        (query.filter === "unoccupied" &&
          a.occupancyVerified === true &&
          a.position &&
          !a.position.lease_occupied &&
          !a.position.daily_occupied) ||
        a.attentionReasons.includes(query.filter as never),
    )
    .sort(
      (a, b) =>
        a.buildingCode.localeCompare(b.buildingCode, undefined, { numeric: true }) ||
        a.unitNo.localeCompare(b.unitNo, undefined, { numeric: true }) ||
        a.id.localeCompare(b.id),
    );
}
