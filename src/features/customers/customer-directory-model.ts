import type { CustomerRow } from "@/types/database";

export const CUSTOMER_DIRECTORY_PAGE_SIZE = 40;
export const CUSTOMER_RELATION_PAGE_SIZE = 25;
export const customerDirectoryFilters = [
  "all",
  "contract",
  "guest",
  "contact",
  "unknown",
  "blacklisted",
] as const;
export type CustomerDirectoryFilter = (typeof customerDirectoryFilters)[number];
export type CustomerRelationRole =
  "lease" | "sale" | "daily_guest" | "daily_agent" | "daily_unknown" | "park_link";
export interface CustomerDirectoryQuery {
  projectId: string;
  buildingId: string;
  search: string;
  filter: CustomerDirectoryFilter;
  page: number;
}
export interface CustomerDirectoryBuilding {
  id: string;
  code: string;
  label: string;
  project: { id: string; code: string; label: string } | null;
}
export interface CustomerDirectoryRow {
  membershipStatus?: "current" | "archived";
  id: string;
  name: string;
  phone: string | null;
  isBlacklisted: boolean;
  hasDocument: boolean;
  roles: CustomerRelationRole[];
  rooms: string[];
  roomCount: number;
  relationshipCount: number;
  lastBusinessDate: string | null;
}
export interface CustomerRelation {
  brand?: string | null;
  relationshipKind?: "signed_contract" | "reservation" | null;
  signingState?: "signed_effective" | "unconfirmed" | null;
  sourceReference?: string | null;
  signedDate?: string | null;
  id: string;
  role: CustomerRelationRole;
  unitId: string;
  unitNo: string;
  buildingId: string;
  buildingLabel: string;
  projectId: string | null;
  code: string | null;
  startDate: string | null;
  endDate: string | null;
  endDateKind: "actual" | "expected" | null;
  status: string;
}
export type CustomerDirectoryProfile = Omit<CustomerRow, "encrypted_document_no"> & {
  hasDocument: boolean;
  membershipStatus?: "current" | "archived";
};
export interface CustomerDirectoryData {
  mode: "list" | "detail";
  query: CustomerDirectoryQuery;
  pageSize: 40;
  total: number;
  scopeCount: number;
  buildings: CustomerDirectoryBuilding[];
  rows: CustomerDirectoryRow[];
  profile: CustomerDirectoryProfile | null;
  relationships: CustomerRelation[];
  relationshipPage: number;
  relationshipTotal: number;
}
export class CustomerDirectoryError extends Error {
  constructor(public status = 503) {
    super("CustomerDirectoryUnavailable");
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function customerDirectoryId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
export function parseCustomerDirectoryQuery(raw: Record<string, unknown>): CustomerDirectoryQuery {
  if (
    Object.keys(raw).some(
      (k) => !["projectId", "buildingId", "search", "filter", "page"].includes(k),
    ) ||
    Object.values(raw).some((v) => typeof v !== "string" && typeof v !== "number")
  )
    throw new CustomerDirectoryError(400);
  const query = {
    projectId: String(raw.projectId ?? "").toLowerCase(),
    buildingId: String(raw.buildingId ?? "").toLowerCase(),
    search: String(raw.search ?? "").trim(),
    filter: String(raw.filter ?? "all"),
    page: Number(raw.page ?? 1),
  };
  if (
    (query.projectId && query.projectId !== "__unassigned__" && !uuid.test(query.projectId)) ||
    (query.buildingId && !uuid.test(query.buildingId)) ||
    (query.projectId === "__unassigned__" && query.buildingId) ||
    query.search.length > 200 ||
    !customerDirectoryFilters.includes(query.filter as CustomerDirectoryFilter) ||
    !Number.isSafeInteger(query.page) ||
    query.page < 1 ||
    query.page > 100000
  )
    throw new CustomerDirectoryError(400);
  return query as CustomerDirectoryQuery;
}
export function customerDirectoryQueryKey(query: CustomerDirectoryQuery) {
  return JSON.stringify([
    query.projectId,
    query.buildingId,
    query.search,
    query.filter,
    query.page,
  ]);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CustomerDirectoryError();
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new CustomerDirectoryError();
  return value;
}
function date(value: unknown) {
  if (value === null) return;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new CustomerDirectoryError();
}
function nullableText(value: unknown) {
  if (value !== null && typeof value !== "string") throw new CustomerDirectoryError();
}
const roles = ["lease", "sale", "daily_guest", "daily_agent", "daily_unknown", "park_link"];
export function decodeCustomerDirectory(
  value: unknown,
  query: CustomerDirectoryQuery,
  mode: "list" | "detail",
  customerId?: string,
  relationshipPage = 1,
): CustomerDirectoryData {
  const data = object(value);
  if (
    data.mode !== mode ||
    customerDirectoryQueryKey(parseCustomerDirectoryQuery(object(data.query))) !==
      customerDirectoryQueryKey(query) ||
    data.pageSize !== 40 ||
    data.relationshipPage !== relationshipPage
  )
    throw new CustomerDirectoryError();
  count(data.total);
  count(data.scopeCount);
  count(data.relationshipTotal);
  if (Number(data.total) > Number(data.scopeCount)) throw new CustomerDirectoryError();
  for (const key of ["rows", "buildings", "relationships"])
    if (!Array.isArray(data[key])) throw new CustomerDirectoryError();
  const buildings = new Map<string, CustomerDirectoryBuilding>();
  for (const item of data.buildings as unknown[]) {
    const b = object(item);
    if (
      !customerDirectoryId(b.id) ||
      buildings.has(b.id) ||
      typeof b.code !== "string" ||
      typeof b.label !== "string"
    )
      throw new CustomerDirectoryError();
    if (b.project !== null) {
      const p = object(b.project);
      if (!customerDirectoryId(p.id) || typeof p.code !== "string" || typeof p.label !== "string")
        throw new CustomerDirectoryError();
    }
    buildings.set(b.id, b as unknown as CustomerDirectoryBuilding);
  }
  if (
    query.projectId &&
    query.projectId !== "__unassigned__" &&
    ![...buildings.values()].some((b) => b.project?.id === query.projectId)
  )
    throw new CustomerDirectoryError();
  if (
    query.buildingId &&
    (!buildings.has(query.buildingId) ||
      (query.projectId && buildings.get(query.buildingId)?.project?.id !== query.projectId))
  )
    throw new CustomerDirectoryError();
  const ids = new Set<string>();
  for (const item of data.rows as unknown[]) {
    const row = object(item);
    if (
      !customerDirectoryId(row.id) ||
      ids.has(row.id) ||
      typeof row.name !== "string" ||
      typeof row.isBlacklisted !== "boolean" ||
      typeof row.hasDocument !== "boolean" ||
      !Array.isArray(row.roles) ||
      row.roles.some((role) => !roles.includes(String(role))) ||
      new Set(row.roles).size !== row.roles.length ||
      !Array.isArray(row.rooms) ||
      row.rooms.some((room) => typeof room !== "string") ||
      row.rooms.length > 3
    )
      throw new CustomerDirectoryError();
    nullableText(row.phone);
    if (
      row.membershipStatus !== undefined &&
      !["current", "archived"].includes(String(row.membershipStatus))
    )
      throw new CustomerDirectoryError();
    date(row.lastBusinessDate);
    count(row.roomCount);
    count(row.relationshipCount);
    if (
      Number(row.roomCount) < row.rooms.length ||
      Number(row.relationshipCount) < Number(row.roomCount)
    )
      throw new CustomerDirectoryError();
    ids.add(row.id);
  }
  if (mode === "list") {
    if (
      (data.rows as unknown[]).length !==
        Math.min(40, Math.max(0, Number(data.total) - (query.page - 1) * 40)) ||
      data.profile !== null ||
      (data.relationships as unknown[]).length ||
      data.relationshipTotal !== 0
    )
      throw new CustomerDirectoryError();
  } else {
    const profile = object(data.profile);
    if (
      profile.membershipStatus !== undefined &&
      !["current", "archived"].includes(String(profile.membershipStatus))
    )
      throw new CustomerDirectoryError();
    if (
      !customerId ||
      profile.id !== customerId ||
      (data.rows as CustomerDirectoryRow[]).length !== 1 ||
      !ids.has(customerId) ||
      typeof profile.name !== "string" ||
      typeof profile.is_blacklisted !== "boolean" ||
      typeof profile.blacklist_permanent !== "boolean" ||
      typeof profile.hasDocument !== "boolean" ||
      "encrypted_document_no" in profile
    )
      throw new CustomerDirectoryError();
    for (const key of [
      "phone",
      "notes",
      "gender",
      "document_type",
      "blacklist_reason",
      "blacklist_operator_id",
      "blacklist_date",
    ])
      nullableText(profile[key]);
    if (
      typeof profile.created_at !== "string" ||
      typeof profile.updated_at !== "string" ||
      (data.rows as CustomerDirectoryRow[])[0].relationshipCount !== data.relationshipTotal ||
      (data.relationships as unknown[]).length !==
        Math.min(25, Math.max(0, Number(data.relationshipTotal) - (relationshipPage - 1) * 25))
    )
      throw new CustomerDirectoryError();
  }
  const relationIds = new Set<string>();
  for (const item of data.relationships as unknown[]) {
    const rel = object(item);
    const key = `${rel.role}:${rel.id}`;
    const building = buildings.get(String(rel.buildingId));
    if (
      !customerDirectoryId(rel.id) ||
      !roles.includes(String(rel.role)) ||
      !customerDirectoryId(rel.unitId) ||
      !building ||
      rel.projectId !== (building.project?.id ?? null) ||
      (query.projectId &&
        query.projectId !== "__unassigned__" &&
        rel.projectId !== query.projectId) ||
      (query.buildingId && rel.buildingId !== query.buildingId) ||
      relationIds.has(key) ||
      typeof rel.unitNo !== "string" ||
      typeof rel.buildingLabel !== "string" ||
      typeof rel.status !== "string"
    )
      throw new CustomerDirectoryError();
    nullableText(rel.code);
    for (const key of ["brand", "sourceReference"])
      if (rel[key] !== undefined) nullableText(rel[key]);
    if (rel.signedDate !== undefined) date(rel.signedDate);
    if (
      rel.relationshipKind != null &&
      !["signed_contract", "reservation"].includes(String(rel.relationshipKind))
    )
      throw new CustomerDirectoryError();
    if (
      rel.signingState != null &&
      !["signed_effective", "unconfirmed"].includes(String(rel.signingState))
    )
      throw new CustomerDirectoryError();
    if (
      rel.role === "park_link" &&
      !["signed_effective", "unconfirmed"].includes(String(rel.status))
    )
      throw new CustomerDirectoryError();
    date(rel.startDate);
    date(rel.endDate);
    if (
      (rel.endDate === null && rel.endDateKind !== null) ||
      (rel.endDate !== null && !["actual", "expected"].includes(String(rel.endDateKind)))
    )
      throw new CustomerDirectoryError();
    relationIds.add(key);
  }
  return data as unknown as CustomerDirectoryData;
}
export function customerDirectoryHref(
  query: CustomerDirectoryQuery,
  locale: "zh" | "fr",
  patch: Partial<CustomerDirectoryQuery> = {},
  customerId?: string,
  returnTo?: string | null,
) {
  const q = { ...query, ...patch };
  const params = new URLSearchParams();
  if (q.projectId) params.set("project", q.projectId);
  if (q.buildingId) params.set("building", q.buildingId);
  if (q.search) params.set("q", q.search);
  if (q.filter !== "all") params.set("filter", q.filter);
  if (q.page !== 1) params.set("page", String(q.page));
  if (customerId) params.set("customer", customerId);
  if (returnTo) params.set("returnTo", returnTo);
  return `${locale === "fr" ? "/fr" : ""}/customers${params.size ? `?${params}` : ""}`;
}
