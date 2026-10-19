import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import type { UnitBusinessFlagRow, UnitRow } from "@/types/database";
import type { UnitPosition } from "./operational-position";

export const UNIT_WORKBENCH_PAGE_SIZE = 50;
export const unitWorkbenchUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type UnitWorkbenchFilter =
  "all" | "occupied" | "unoccupied" | "attention" | "sold" | "maintenance" | "locked" | "cleaning";
export interface UnitWorkbenchBuilding {
  id: string;
  code: string;
  display_name: string;
  project_id: string;
  project_code: string;
  project_name: string;
  allows_sale: boolean;
}
export interface UnitWorkbenchQuery {
  project: string;
  building: string;
  q: string;
  floor: string;
  kind: string;
  filter: UnitWorkbenchFilter;
  business: string;
  view: "list" | "floor";
  page: number;
  unit: string;
  returnTo: string;
}
export interface UnitWorkbenchRecord {
  unit: UnitRow;
  position: UnitPosition | null;
  flags: UnitBusinessFlagRow[];
}
export interface UnitWorkbenchPositionRecord {
  unit: Pick<UnitRow, "occupancy_verified" | "construction_status">;
  position: UnitPosition | null;
}
export interface UnitWorkbenchData {
  query: UnitWorkbenchQuery;
  buildings: UnitWorkbenchBuilding[];
  building: UnitWorkbenchBuilding | null;
  scopeUnavailable: boolean;
  rows: UnitWorkbenchRecord[];
  selected: UnitWorkbenchRecord | null;
  selectedUnavailable: boolean;
  floors: string[];
  total: number;
  scopeTotal: number;
  summary: { occupied: number; attention: number; unverified: number };
}
export type UnitWorkbenchSearch = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined, max = 120) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const filters: UnitWorkbenchFilter[] = [
  "all",
  "occupied",
  "unoccupied",
  "attention",
  "sold",
  "maintenance",
  "locked",
  "cleaning",
];
export function parseUnitWorkbenchQuery(input: UnitWorkbenchSearch): UnitWorkbenchQuery {
  const requestedPage = one(input.page, 8);
  const unit = typeof input.unit === "string" ? input.unit.trim() : "";
  return {
    project: one(input.project, 80),
    building: one(input.building, 80),
    q: one(input.q),
    floor: one(input.floor, 40),
    kind: ["apartment", "parking", "storefront", "office", "warehouse"].includes(one(input.kind))
      ? one(input.kind)
      : "",
    filter: filters.includes(one(input.filter) as UnitWorkbenchFilter)
      ? (one(input.filter) as UnitWorkbenchFilter)
      : "all",
    business: ["daily_rental", "long_lease", "sale"].includes(one(input.business))
      ? one(input.business)
      : "",
    view: input.view === "floor" ? "floor" : "list",
    page: /^\d+$/.test(requestedPage) ? Math.max(1, Math.min(Number(requestedPage), 100000)) : 1,
    unit: unitWorkbenchUuid.test(unit) ? unit : "",
    returnTo: one(input.returnTo, 2048),
  };
}
export function unitWorkbenchHref(
  locale: Locale,
  query: UnitWorkbenchQuery,
  patch: Partial<UnitWorkbenchQuery> = {},
): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  for (const key of [
    "project",
    "building",
    "q",
    "floor",
    "kind",
    "business",
    "unit",
    "returnTo",
  ] as const)
    if (next[key]) params.set(key, next[key]);
  if (next.filter !== "all") params.set("filter", next.filter);
  if (next.view !== "list") params.set("view", next.view);
  if (next.page > 1) params.set("page", String(next.page));
  return routeFor(locale, `/units${params.size ? `?${params}` : ""}`);
}
export function unitOccupancyVerified(record: UnitWorkbenchPositionRecord): boolean {
  return !!record.position && record.unit.occupancy_verified === true;
}
export function unitOccupancyText(record: UnitWorkbenchPositionRecord, locale: Locale): string {
  const zh = locale === "zh";
  if (record.position?.daily_occupied && record.position.lease_occupied)
    return zh ? "日租与长租同时占用 · 需核对" : "Séjour et bail simultanés · à vérifier";
  if (record.position?.daily_occupied) return zh ? "日租实际入住" : "Séjour effectif";
  if (record.position?.lease_occupied) return zh ? "长租占用" : "Bail actif";
  if (!unitOccupancyVerified(record)) return zh ? "占用待核实" : "Occupation à vérifier";
  return zh ? "无当前占用" : "Sans occupation actuelle";
}
export function unitNeedsVerification(record: UnitWorkbenchPositionRecord): boolean {
  return (
    !unitOccupancyVerified(record) ||
    !record.unit.construction_status ||
    record.unit.construction_status === "unverified"
  );
}
export function matchesUnitWorkbenchFilter(
  record: UnitWorkbenchPositionRecord,
  filter: UnitWorkbenchFilter,
): boolean {
  const { position } = record;
  if (filter === "all") return true;
  if (filter === "attention")
    return (
      unitNeedsVerification(record) ||
      !!position?.cleaning_pending ||
      position?.operational_condition === "maintenance" ||
      position?.operational_condition === "locked"
    );
  if (!position) return false;
  if (filter === "occupied") return position.daily_occupied || position.lease_occupied;
  if (filter === "unoccupied")
    return unitOccupancyVerified(record) && !position.daily_occupied && !position.lease_occupied;
  if (filter === "sold") return position.ownership === "sold";
  if (filter === "cleaning") return position.cleaning_pending;
  return position.operational_condition === filter;
}
export function constructionLabel(value: string | undefined, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    planned: ["规划中", "Planifié"],
    under_construction: ["建设中", "En construction"],
    inspection_pending: ["待验收", "Réception en attente"],
    fitout_pending: ["待装修", "Aménagement en attente"],
    operational: ["可投入使用", "Opérationnel"],
    paused: ["暂停", "Suspendu"],
    unverified: ["待核实", "À vérifier"],
  };
  return value && labels[value]
    ? labels[value][locale === "zh" ? 0 : 1]
    : locale === "zh"
      ? "待核实"
      : "À vérifier";
}
export type UnitBusinessRelation = {
  id: string;
  type: "lease" | "sale" | "daily";
  contractNo: string | null;
  status: string;
  start: string | null;
  end: string | null;
  endDateKind: "actual" | "expected" | null;
  endConfirmed: boolean;
  customerId: string | null;
  customerName: string | null;
  agentId: string | null;
  agentName: string | null;
};
export interface UnitBusinessContext {
  unitId: string;
  buildingId: string;
  projectId: string;
  relations: UnitBusinessRelation[];
  total: number;
  page: number;
}
export function decodeUnitBusinessContext(
  value: unknown,
  unitId: string,
  page: number,
): UnitBusinessContext {
  if (!value || typeof value !== "object") throw new Error("InvalidUnitBusinessContext");
  const item = value as UnitBusinessContext;
  if (
    item.unitId !== unitId ||
    !unitWorkbenchUuid.test(item.buildingId) ||
    !unitWorkbenchUuid.test(item.projectId) ||
    item.page !== page ||
    !Number.isSafeInteger(item.total) ||
    item.total < 0 ||
    !Array.isArray(item.relations) ||
    item.relations.length > 30 ||
    item.relations.length > item.total ||
    item.relations.length !== Math.min(30, Math.max(0, item.total - (page - 1) * 30))
  )
    throw new Error("InvalidUnitBusinessContext");
  for (const relation of item.relations) {
    if (
      !relation ||
      !unitWorkbenchUuid.test(relation.id) ||
      !["lease", "sale", "daily"].includes(relation.type) ||
      typeof relation.status !== "string" ||
      typeof relation.endConfirmed !== "boolean" ||
      (relation.end === null && relation.endDateKind !== null) ||
      (relation.end !== null && !["actual", "expected"].includes(String(relation.endDateKind)))
    )
      throw new Error("InvalidUnitBusinessContext");
    for (const key of ["contractNo", "start", "end", "customerName", "agentName"] as const)
      if (relation[key] !== null && typeof relation[key] !== "string")
        throw new Error("InvalidUnitBusinessContext");
    for (const key of ["customerId", "agentId"] as const)
      if (relation[key] !== null && !unitWorkbenchUuid.test(relation[key]!))
        throw new Error("InvalidUnitBusinessContext");
  }
  return item;
}
