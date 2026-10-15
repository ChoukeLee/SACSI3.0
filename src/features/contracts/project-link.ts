/** Resolve navigation only within the already RLS-filtered project perimeter. */
export function resolveContractProjectLink(
  buildings: { project_id?: string | null; project?: { code: string } | null }[],
  requested?: string | string[],
) {
  if (requested === undefined || requested === "") return undefined;
  if (Array.isArray(requested) || requested.length > 80)
    throw new Error("ContractProjectUnavailable");
  const match = buildings.find(
    (building) =>
      building.project_id === requested ||
      building.project?.code.toUpperCase() === requested.toUpperCase(),
  );
  if (!match?.project_id) throw new Error("ContractProjectUnavailable");
  return match.project_id;
}
