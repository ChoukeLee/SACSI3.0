import {
  ALL_BUILDINGS,
  groupLeaseBuildings,
  type LeaseBuilding,
} from "@/features/leases/project-scope";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LEASE_SCOPE_LEGACY_KEY = "lease-project-scope";
export const LEASE_SCOPE_LEGACY_CLAIM_KEY = "sacsi-lease-scope-legacy-owner";
export function leaseScopeStorageKey(cookieName?: string) {
  return cookieName ? `${cookieName}:memory` : LEASE_SCOPE_LEGACY_KEY;
}
export interface LeaseScopePreference {
  cookieName: string;
  serverResolved: boolean;
}
export function leaseScopeCookieName(viewerId?: string, workArea: "sacsi" | "cimac" = "sacsi") {
  return viewerId && uuid.test(viewerId) ? `${workArea}_lease_scope_${viewerId}` : undefined;
}
export function defaultLeaseScope(buildings: LeaseBuilding[]) {
  const initial = buildings.find((b) => b.code === "SACSI11");
  const projectId = initial?.project_id ?? groupLeaseBuildings(buildings)[0]?.id ?? "";
  return {
    projectId: projectId === "unassigned" ? "" : projectId,
    buildingId: initial?.id ?? "",
  };
}
/** A preference is navigation input, never authorization. Only current visible membership wins. */
export function validatedLeaseScope(buildings: LeaseBuilding[], raw?: string) {
  if (!raw || raw.length > 256) return undefined;
  try {
    const data: unknown = JSON.parse(decodeURIComponent(raw));
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    const value = data as Record<string, unknown>;
    if (
      Object.keys(value).some((key) => key !== "projectId" && key !== "buildingId") ||
      typeof value.projectId !== "string" ||
      !uuid.test(value.projectId) ||
      typeof value.buildingId !== "string" ||
      (value.buildingId !== "" && !uuid.test(value.buildingId))
    )
      return undefined;
    const members = buildings.filter((b) => b.project_id === value.projectId);
    if (!members.length || (value.buildingId && !members.some((b) => b.id === value.buildingId)))
      return undefined;
    return { projectId: value.projectId, buildingId: value.buildingId };
  } catch {
    return undefined;
  }
}
export function serializeLeaseScope(projectId: string, buildingId: string) {
  return encodeURIComponent(
    JSON.stringify({ projectId, buildingId: buildingId === ALL_BUILDINGS ? "" : buildingId }),
  );
}
