import "server-only";

import type {
  OperatingAssetDirectoryAsset,
  OperatingAssetDirectoryData,
  OperatingAssetLeaseGroup,
} from "./operating-asset-directory-model";

const dormitoryName = "孵化园配套宿舍（四组明细）";
const dormitorySource =
  "sha256:e3ed7762344e6e731633bd753702308c51c6a4d24559ee520065ab947d9b16c6|file:公寓、仓库租金截止日期等.xlsx|sheet:孵化园|range:";

// The linked warehouse owner is listed in the preceding row. Room 308 has
// its own named row after six blank rows, so use the name recorded there.
const dormitoryRows = [
  { row: 17, label: "宿舍 · 3间", tenantRow: 16, tenant: "黄帅" },
  { row: 23, label: "宿舍 · 4间", tenantRow: 22, tenant: "胡建初" },
  { row: 29, label: "宿舍 · 6间", tenantRow: 28, tenant: "付宇豪" },
  { row: 43, label: "308宿舍 · 1间", tenantRow: 43, tenant: "郭鹏" },
];

const dormitoryLeaseGroups = dormitoryRows.map<OperatingAssetLeaseGroup>(
  ({ row, label, tenantRow, tenant }) => ({
    key: `row-${row}`,
    label,
    sourceRef: `${dormitorySource}A${row}:D${row}`,
    receiptSourceRef: `${dormitorySource}I${row}:K${row}`,
    tenantEvidence: {
      names: [tenant],
      sourceRef: `${dormitorySource}B${tenantRow}`,
      classification: "latest_source",
      scope: "asset",
    },
  }),
);

export function withIncubatorDormitoryLeaseGroups(
  data: OperatingAssetDirectoryData,
): OperatingAssetDirectoryData {
  return {
    ...data,
    assets: data.assets.map((asset) =>
      asset.sourceKey === "incubator:dormitory" &&
      asset.name === dormitoryName &&
      dormitoryLeaseGroups.every(({ sourceRef }) => asset.sourceRefs.includes(sourceRef))
        ? { ...asset, leaseGroups: dormitoryLeaseGroups }
        : asset,
    ),
  };
}

export function projectOperatingLeaseGroups(data: OperatingAssetDirectoryData, today: string) {
  const billingGroups = new Map<string, OperatingAssetDirectoryAsset[]>();
  for (const asset of data.assets) {
    const group = asset.leaseEvidence?.billingGroup;
    if (!group || asset.projectId !== data.projectId) continue;
    const members = billingGroups.get(group.primarySourceKey);
    if (members) members.push(asset);
    else billingGroups.set(group.primarySourceKey, [asset]);
  }

  const primaryByMemberId = new Map<string, string>();
  const primaryViews = new Map<string, OperatingAssetDirectoryAsset>();
  for (const [primarySourceKey, assets] of billingGroups) {
    const primary = assets.find(({ sourceKey }) => sourceKey === primarySourceKey);
    const group = primary?.leaseEvidence?.billingGroup;
    const tenant = primary?.leaseEvidence?.tenantEvidence;
    if (!primary || !group || tenant?.scope !== "group" || assets.length < 2) continue;

    const members = assets.filter(({ id }) => id !== primary.id);
    if (
      assets.some(
        ({ unitId, category, group: assetGroup }) =>
          unitId !== null || category !== "warehouse" || assetGroup !== primary.group,
      ) ||
      members.some(({ leaseEvidence }) => {
        const memberTenant = leaseEvidence?.tenantEvidence;
        return (
          leaseEvidence?.outstanding != null ||
          leaseEvidence?.nextPayment != null ||
          leaseEvidence?.billingGroup?.label !== group.label ||
          memberTenant?.scope !== "group" ||
          memberTenant.names.join("\n") !== tenant.names.join("\n")
        );
      })
    )
      continue;

    const { monthlyRent } = group;
    const activeRate =
      (!monthlyRent.effectiveFrom || monthlyRent.effectiveFrom <= today) &&
      (!monthlyRent.effectiveThrough || monthlyRent.effectiveThrough >= today);
    primaryViews.set(primary.id, {
      ...primary,
      displayName: `${primary.displayGroup} · ${group.label}`,
      referenceRent: activeRate ? monthlyRent : null,
      searchAliases: members.flatMap(({ code, name, displayName }) => [code, name, displayName]),
    });
    for (const member of members) primaryByMemberId.set(member.id, primary.id);
  }

  if (!primaryViews.size) {
    return { data: withIncubatorDormitoryLeaseGroups(data), primaryByMemberId };
  }

  const primaryEntryIds = new Set(
    data.entries.filter(({ assetId }) => primaryViews.has(assetId)).map(({ id }) => id),
  );
  const seen = new Set<string>();
  const entries = data.entries.flatMap((entry) => {
    const primaryId = primaryByMemberId.get(entry.assetId);
    if (!primaryId && !primaryViews.has(entry.assetId)) return [entry];
    if (seen.has(entry.id) || (primaryId && primaryEntryIds.has(entry.id))) return [];
    seen.add(entry.id);
    return [
      primaryId ? { ...entry, assetId: primaryId, billingMemberAssetId: entry.assetId } : entry,
    ];
  });
  const assets = data.assets
    .filter(({ id }) => !primaryByMemberId.has(id))
    .map((asset) => primaryViews.get(asset.id) ?? asset);
  return {
    data: withIncubatorDormitoryLeaseGroups({ ...data, assets, entries }),
    primaryByMemberId,
  };
}
