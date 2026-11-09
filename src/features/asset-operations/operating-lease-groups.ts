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

  const seen = new Set<string>();
  const rentEntriesBySource = new Map<string, OperatingAssetDirectoryEntry[]>();
  for (const entry of entries) {
    if (
      entry.assetId !== asset.id ||
      entry.kind !== "income" ||
      entry.category !== "rent" ||
      seen.has(entry.id)
    )
      continue;
    seen.add(entry.id);
    const receipts = rentEntriesBySource.get(entry.sourceRef);
    if (receipts) receipts.push(entry);
    else rentEntriesBySource.set(entry.sourceRef, [entry]);
  }
  return leaseGroups.map((group) => {
    const { sourceRef, receiptSourceRef, tenantEvidence } = group;
    const receipts = rentEntriesBySource.get(receiptSourceRef) ?? [];
    rentEntriesBySource.delete(receiptSourceRef);
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
        leaseEvidence: { assetSourceRef: sourceRef, leaseListed: true, tenantEvidence },
      },
      entries: receipts,
    };
  });
}
