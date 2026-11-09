import "server-only";

import type {
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
