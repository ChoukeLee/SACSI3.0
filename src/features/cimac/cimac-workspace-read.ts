import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CustomerDirectoryError,
  decodeCustomerDirectory,
  type CustomerDirectoryRow,
  type CustomerDirectoryProfile,
  type CustomerRelation,
} from "@/features/customers/customer-directory-model";
import {
  readUnitBusinessContext,
  UnitBusinessContextError,
} from "@/features/units/unit-business-context-read";
import { decodeUnitBusinessContext } from "@/features/units/unit-workbench-model";
import {
  assertCimacWorkspaceScope,
  assertCimacWorkspaceQuery,
  cimacAssetCounts,
  cimacWorkspaceObject,
  decodeCimacAsset,
  decodeCimacWorkspaceScope,
  filterCimacAssets,
} from "./cimac-workspace-model";
import { cimacWorkspaceId, parseCimacWorkspaceQuery } from "./cimac-workspace-query";
import {
  CimacWorkspaceReadError,
  type CimacWorkspaceScope,
  type CimacWorkspaceQuery,
  type CimacHomeData,
  type CimacCustomerDirectoryData,
  type CimacCustomerData,
  type CimacAssetDirectoryData,
  type CimacAssetData,
} from "./cimac-workspace-types";

type Client = Pick<SupabaseClient, "from" | "rpc">;
type Row = Record<string, unknown>;
const customerRow = (r: CustomerDirectoryRow): CustomerDirectoryRow => ({
  ...(r.membershipStatus ? { membershipStatus: r.membershipStatus } : {}),
  id: r.id,
  name: r.name,
  phone: r.phone,
  isBlacklisted: r.isBlacklisted,
  hasDocument: r.hasDocument,
  roles: [...r.roles],
  rooms: [...r.rooms],
  roomCount: r.roomCount,
  relationshipCount: r.relationshipCount,
  lastBusinessDate: r.lastBusinessDate,
});
const profileRow = (p: CustomerDirectoryProfile): CustomerDirectoryProfile => ({
  ...(p.membershipStatus ? { membershipStatus: p.membershipStatus } : {}),
  id: p.id,
  name: p.name,
  gender: p.gender,
  document_type: p.document_type,
  phone: p.phone,
  notes: p.notes,
  is_blacklisted: p.is_blacklisted,
  blacklist_reason: p.blacklist_reason,
  blacklist_operator_id: p.blacklist_operator_id,
  blacklist_date: p.blacklist_date,
  blacklist_permanent: p.blacklist_permanent,
  created_at: p.created_at,
  updated_at: p.updated_at,
  hasDocument: p.hasDocument,
});
const relationRow = (r: CustomerRelation): CustomerRelation => ({
  ...(r.brand !== undefined ? { brand: r.brand } : {}),
  ...(r.relationshipKind !== undefined ? { relationshipKind: r.relationshipKind } : {}),
  ...(r.signingState !== undefined ? { signingState: r.signingState } : {}),
  ...(r.sourceReference !== undefined ? { sourceReference: r.sourceReference } : {}),
  ...(r.signedDate !== undefined ? { signedDate: r.signedDate } : {}),
  id: r.id,
  role: r.role,
  unitId: r.unitId,
  unitNo: r.unitNo,
  buildingId: r.buildingId,
  buildingLabel: r.buildingLabel,
  projectId: r.projectId,
  code: r.code,
  startDate: r.startDate,
  endDate: r.endDate,
  endDateKind: r.endDateKind,
  status: r.status,
});
const unitColumns =
  "id,building_id,code,unit_no,kind,asset_subtype,floor_label,area_sqm,construction_status,occupancy_verified,updated_at";
const positionColumns =
  "id,building_id,ownership,operational_condition,daily_occupied,lease_occupied,cleaning_pending,daily_enabled,lease_enabled,lease_pending,lease_start_date";
const fail = (error?: { code?: string } | null): never => {
  throw new CimacWorkspaceReadError(error?.code === "42501" ? 403 : 503);
};
async function existingRead<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof CustomerDirectoryError || error instanceof UnitBusinessContextError) {
      const status = error.status;
      throw new CimacWorkspaceReadError(
        status === 400 || status === 403 || status === 404 ? status : 503,
      );
    }
    throw new CimacWorkspaceReadError();
  }
}
type Page = { data: unknown[] | null; error: { code?: string } | null; count?: number | null };
async function bounded(
  read: (from: number, to: number) => PromiseLike<Page>,
  limit: number,
): Promise<Row[]> {
  const result: Row[] = [],
    seen = new Set<string>();
  let expected: number | undefined;
  for (let from = 0; ; from += 1000) {
    const { data, error, count } = await read(from, from + 999);
    if (error) fail(error);
    if (!Array.isArray(data)) throw new CimacWorkspaceReadError();
    if (!Number.isSafeInteger(count) || Number(count) < 0) fail();
    if (Number(count) > limit) throw new CimacWorkspaceReadError(413);
    if (expected !== undefined && expected !== count) fail();
    expected = Number(count);
    for (const raw of data) {
      const row = cimacWorkspaceObject(raw),
        id = String(row.id);
      cimacWorkspaceId(id);
      if (seen.has(id)) fail();
      seen.add(id);
      result.push(row);
    }
    if (result.length === expected) return result;
    if (!data.length || result.length > expected) fail();
  }
}
/** Scope is resolved from current-user RLS, never guessed from a selected asset or first visible project. */
export async function readCimacWorkspaceScope(client: Client): Promise<CimacWorkspaceScope> {
  const { data: project, error } = await client
    .from("projects")
    .select("id,code,display_name")
    .eq("code", "CIMAC")
    .eq("is_active", true)
    .maybeSingle();
  if (error) fail(error);
  if (!project) throw new CimacWorkspaceReadError(403);
  const p = cimacWorkspaceObject(project);
  if (p.code !== "CIMAC") throw new CimacWorkspaceReadError(403);
  cimacWorkspaceId(p.id);
  const buildings = await bounded(
    (from, to) =>
      client
        .from("buildings")
        .select("id,project_id,code,display_name,construction_status,is_active", { count: "exact" })
        .eq("project_id", String(p.id))
        .order("code")
        .order("id")
        .range(from, to),
    1000,
  );
  return decodeCimacWorkspaceScope(project, buildings);
}
async function inventory(client: Client, scope: CimacWorkspaceScope) {
  assertCimacWorkspaceScope(scope);
  const ids = scope.buildings.map((b) => b.id);
  if (!ids.length) return [];
  const [units, positions] = await Promise.all([
    bounded(
      (from, to) =>
        client
          .from("units")
          .select(unitColumns, { count: "exact" })
          .in("building_id", ids)
          .order("id")
          .range(from, to),
      10000,
    ),
    bounded(
      (from, to) =>
        client
          .from("unit_operational_position")
          .select(positionColumns, { count: "exact" })
          .in("building_id", ids)
          .order("id")
          .range(from, to),
      10000,
    ),
  ]);
  const unitIds = new Set(units.map((r) => String(r.id))),
    byId = new Map(positions.map((p) => [String(p.id), p]));
  if (positions.some((p) => !unitIds.has(String(p.id)))) fail();
  return units.map((u) => decodeCimacAsset(scope, u, byId.get(String(u.id)) ?? null));
}
function queryFor(
  scope: CimacWorkspaceScope,
  raw: CimacWorkspaceQuery | undefined,
  section: "customers" | "assets",
) {
  const query = raw
    ? parseCimacWorkspaceQuery({ ...raw, returnTo: raw.returnTo ?? undefined }, section)
    : parseCimacWorkspaceQuery({}, section);
  assertCimacWorkspaceQuery(scope, query);
  return query;
}
async function customerDirectory(
  client: Client,
  scope: CimacWorkspaceScope,
  query: CimacWorkspaceQuery,
  id?: string,
) {
  assertCimacWorkspaceQuery(scope, query);
  const baseQuery = {
    projectId: scope.project.id,
    buildingId: query.building,
    search: id ? "" : query.q,
    filter: id ? "all" : (query.filter as "all"),
    page: id ? 1 : query.page,
  };
  const membershipStatus = query.membershipStatus ?? "current";
  const { data: raw, error } = await client.rpc("cimac_customer_directory_read_rpc", {
    p_input: { ...baseQuery, membershipStatus },
    p_mode: id ? "detail" : "list",
    p_customer_id: id ?? null,
    p_relation_page: query.relationPage,
  });
  if (error)
    throw new CimacWorkspaceReadError(
      error.code === "42501"
        ? 403
        : error.code === "P0002"
          ? 404
          : error.code === "22023"
            ? 400
            : 503,
    );
  const result = cimacWorkspaceObject(raw);
  const { membershipStatus: echoedMembership, ...echoedBase } = cimacWorkspaceObject(result.query);
  if (echoedMembership !== membershipStatus) fail();
  // CIMAC-only filter is validated here; the shared directory query remains unchanged.
  const data = await existingRead(
    Promise.resolve().then(() =>
      decodeCustomerDirectory(
        { ...result, query: echoedBase },
        baseQuery,
        id ? "detail" : "list",
        id,
        query.relationPage,
      ),
    ),
  );
  if (
    data.query.projectId !== scope.project.id ||
    data.relationships.some(
      (r) =>
        r.projectId !== scope.project.id || !scope.buildings.some((b) => b.id === r.buildingId),
    )
  )
    fail();
  return data;
}
export async function readCimacCustomers(
  client: Client,
  scope: CimacWorkspaceScope,
  raw?: CimacWorkspaceQuery,
): Promise<CimacCustomerDirectoryData> {
  const query = queryFor(scope, raw, "customers"),
    data = await customerDirectory(client, scope, query);
  if (query.page > 1 && (query.page - 1) * 40 >= data.total) throw new CimacWorkspaceReadError(404);
  return {
    scope,
    query,
    rows: data.rows.map(customerRow),
    total: data.total,
    page: query.page,
    pageSize: 40,
  };
}
export async function readCimacCustomer(
  client: Client,
  scope: CimacWorkspaceScope,
  customerId: string,
  raw?: CimacWorkspaceQuery,
): Promise<CimacCustomerData> {
  const id = cimacWorkspaceId(customerId),
    query = queryFor(scope, raw, "customers"),
    data = await customerDirectory(client, scope, query, id);
  if (!data.profile || data.profile.id !== id || data.rows.length !== 1 || data.rows[0].id !== id)
    throw new CimacWorkspaceReadError(404);
  if (query.relationPage > 1 && (query.relationPage - 1) * 25 >= data.relationshipTotal)
    throw new CimacWorkspaceReadError(404);
  return {
    scope,
    query,
    profile: profileRow(data.profile),
    summary: customerRow(data.rows[0]),
    relations: data.relationships.map(relationRow),
    relationPage: query.relationPage,
    relationTotal: data.relationshipTotal,
    pageSize: 25,
  };
}
export async function readCimacAssets(
  client: Client,
  scope: CimacWorkspaceScope,
  raw?: CimacWorkspaceQuery,
): Promise<CimacAssetDirectoryData> {
  const query = queryFor(scope, raw, "assets"),
    all = await inventory(client, scope),
    filtered = filterCimacAssets(all, query),
    from = (query.page - 1) * 50;
  if (query.page > 1 && from >= filtered.length) throw new CimacWorkspaceReadError(404);
  return {
    scope,
    query,
    rows: filtered.slice(from, from + 50),
    summary: cimacAssetCounts(all),
    total: filtered.length,
    page: query.page,
    pageSize: 50,
  };
}
export async function readCimacAsset(
  client: Client,
  scope: CimacWorkspaceScope,
  assetId: string,
  raw?: CimacWorkspaceQuery,
): Promise<CimacAssetData> {
  const id = cimacWorkspaceId(assetId),
    query = queryFor(scope, raw, "assets");
  const result = await client.from("units").select(unitColumns).eq("id", id).maybeSingle();
  if (result.error) fail(result.error);
  if (!result.data) throw new CimacWorkspaceReadError(404);
  const row = cimacWorkspaceObject(result.data);
  if (row.id !== id) fail();
  if (
    !scope.buildings.some((b) => b.id === row.building_id) ||
    (query.building && row.building_id !== query.building)
  )
    throw new CimacWorkspaceReadError(404);
  const position = await client
    .from("unit_operational_position")
    .select(positionColumns)
    .eq("id", id)
    .maybeSingle();
  if (position.error) fail(position.error);
  const asset = decodeCimacAsset(scope, row, position.data ?? null),
    context = decodeUnitBusinessContext(
      await existingRead(
        readUnitBusinessContext(client, id, query.relationPage, {
          project: scope.project.id,
          building: asset.buildingId,
        }),
      ),
      id,
      query.relationPage,
    );
  if (context.projectId !== scope.project.id || context.buildingId !== asset.buildingId) fail();
  return {
    scope,
    query,
    asset,
    relations: context.relations,
    relationPage: query.relationPage,
    relationTotal: context.total,
    pageSize: 30,
  };
}
export async function readCimacHome(
  client: Client,
  scope: CimacWorkspaceScope,
): Promise<CimacHomeData> {
  const [assets, customers] = await Promise.all([
      inventory(client, scope),
      readCimacCustomers(client, scope),
    ]),
    ordered = filterCimacAssets(assets, parseCimacWorkspaceQuery()),
    attention = ordered.filter((a) => a.attentionReasons.length > 0);
  return {
    scope,
    assetSummary: cimacAssetCounts(assets),
    customerCount: customers.total,
    attention: attention.slice(0, 8),
    attentionTotal: attention.length,
    assetIndex: ordered.slice(0, 12),
    readAt: new Date().toISOString(),
  };
}
