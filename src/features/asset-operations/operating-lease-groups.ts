import type {
  OperatingAssetDirectoryAsset,
  OperatingAssetDirectoryEntry,
} from "./operating-asset-directory-model";

interface OperatingLeaseView {
  key: string;
  groupKey?: string;
  asset: OperatingAssetDirectoryAsset;
  entries: OperatingAssetDirectoryEntry[];
}

export function operatingLeaseViews(
  asset: OperatingAssetDirectoryAsset,
  entries: readonly OperatingAssetDirectoryEntry[],
): OperatingLeaseView[] {
  const { leaseGroups, ...parent } = asset;
  if (!leaseGroups?.length) return [{ key: asset.id, asset, entries: [...entries] }];

  const groupBySource = new Map<string, string>();
  for (const { key, receiptSourceRef, receiptSourceRefs } of leaseGroups) {
    for (const source of [receiptSourceRef, ...(receiptSourceRefs ?? [])]) {
      if (!groupBySource.has(source)) groupBySource.set(source, key);
    }
  }
  const seen = new Set<string>();
  const rentEntriesByGroup = new Map<string, OperatingAssetDirectoryEntry[]>();
  for (const entry of entries) {
    const key = groupBySource.get(entry.sourceRef);
    if (
      !key ||
      entry.assetId !== asset.id ||
      entry.kind !== "income" ||
      entry.category !== "rent" ||
      seen.has(entry.id)
    )
      continue;
    seen.add(entry.id);
    const receipts = rentEntriesByGroup.get(key);
    if (receipts) receipts.push(entry);
    else rentEntriesByGroup.set(key, [entry]);
  }
  return leaseGroups.map((group) => {
    const { sourceRef, tenantEvidence, linkedWarehouse, paidRoomCount, notes } = group;
    const receipts = rentEntriesByGroup.get(group.key) ?? [];
    return {
      key: `${asset.id}:${group.key}`,
      groupKey: group.key,
      asset: {
        ...parent,
        displayName: group.label,
        sourceRefs: tenantEvidence ? [sourceRef, tenantEvidence.sourceRef] : [sourceRef],
        monthlyRentNative: null,
        rentCurrency: null,
        referenceRent: null,
        costCoverageThrough: null,
        leaseEvidence: { assetSourceRef: sourceRef, leaseListed: true, tenantEvidence, notes },
        linkedWarehouse,
        paidRoomCount,
      },
      entries: receipts,
    };
  });
}
