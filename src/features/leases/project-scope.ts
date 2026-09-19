export interface LeaseBuilding {
  id: string;
  code: string;
  display_name: string;
  project_id: string | null;
  project: { id: string; code: string; display_name: string } | null;
}

export const ALL_BUILDINGS = "all";

export function groupLeaseBuildings(buildings: LeaseBuilding[]) {
  const groups = new Map<string, { id: string; code: string; name: string; buildings: LeaseBuilding[] }>();
  for (const building of buildings) {
    const id = building.project_id ?? "unassigned";
    if (!groups.has(id)) groups.set(id, {
      id, code: building.project?.code ?? "", name: building.project?.display_name ?? "", buildings: [],
    });
    groups.get(id)!.buildings.push(building);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, buildings: group.buildings.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })) }))
    .sort((a, b) => Number(b.code === "SACSI") - Number(a.code === "SACSI") || a.code.localeCompare(b.code));
}

export function resolveBuildingScope(buildings: LeaseBuilding[], remembered?: string) {
  return remembered && buildings.some((b) => b.id === remembered) ? remembered : ALL_BUILDINGS;
}
