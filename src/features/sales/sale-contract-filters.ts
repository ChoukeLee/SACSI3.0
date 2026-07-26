import type { SaleContractRow } from "@/types/database";

export function getEffectiveSaleContracts(
  contracts: SaleContractRow[],
  unitBuildingMap: Map<string, string>,
  activeBuildingId: string,
) {
  return contracts.filter((contract) => (
    contract.status === "active"
    && (!activeBuildingId || unitBuildingMap.get(contract.unit_id) === activeBuildingId)
  ));
}
