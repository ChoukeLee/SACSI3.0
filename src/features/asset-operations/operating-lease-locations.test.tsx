// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  getOperatingAssetFollowUp,
  type OperatingAssetDirectoryAsset,
} from "./operating-asset-directory-model";
import { OperatingLeaseLocations } from "./operating-lease-locations";

function unit(site: string, id: string, label: string, tenantName: string, selfUse = false) {
  const sourceRef = `test.xlsx!${id}`;
  const asset: OperatingAssetDirectoryAsset = {
    id,
    projectId: "test",
    unitId: null,
    code: id,
    name: `${site}${label}`,
    group: site,
    displayName: `${site}${label}`,
    displayGroup: site,
    category: "warehouse",
    verification: "verified",
    sourceRefs: [sourceRef],
    monthlyRentNative: null,
    rentCurrency: null,
    costCoverageThrough: null,
    updatedAt: "2026-11-09T00:00:00Z",
    referenceRent: null,
    leaseEvidence: {
      assetSourceRef: sourceRef,
      selfUse,
      ...(selfUse
        ? {}
        : {
            paidThrough: { date: "2026-12-31", sourceRef },
            tenantEvidence: {
              names: [tenantName],
              sourceRef,
              classification: "latest_source",
              scope: "asset",
            },
          }),
    },
  };
  return {
    asset,
    followUp: getOperatingAssetFollowUp(asset, [], "2026-11-09"),
    attention: null,
  };
}

it("pages each site, resets on filters and keeps partition labels and tenant names accessible", async () => {
  const fullTenantName = "示例租户名称有限公司 · 仓储配送部";
  const old = [
    ...Array.from({ length: 15 }, (_, index) =>
      unit("老仓库", `unit-${index + 1}`, `${index + 1}号`, `租户${index + 1}`),
    ),
    unit("老仓库", "48-75", "48号—75㎡分区", fullTenantName),
    unit("老仓库", "48-100", "48号—100㎡分区", "示例租户"),
    unit("老仓库", "48-600", "48号—600㎡分区", "", true),
  ];
  const next = [unit("新仓库", "new-1", "1号", "新仓库租户")];
  const onSelectAsset = vi.fn();
  const host = document.createElement("div");
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const render = async (activeSite: "old" | "new" = "old", statusKey = "all") =>
    act(async () =>
      root.render(
        <OperatingLeaseLocations
          locale="zh"
          sites={[
            { id: "old", name: "老仓库", count: old.length, followUpCount: 0 },
            { id: "new", name: "新仓库", count: next.length, followUpCount: 0 },
          ]}
          activeSite={activeSite}
          rows={activeSite === "old" ? old : next}
          selectedAssetId={null}
          statusFilter={null}
          statusKey={statusKey}
          onSelectSite={() => {}}
          onSelectAsset={onSelectAsset}
        />,
      ),
    );
  const rows = () => [
    ...host.querySelectorAll<HTMLButtonElement>('[aria-label="出租单元"] button'),
  ];
  const pageButton = (text: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="出租单元分页"] button')].find(
      (button) => button.textContent === text,
    )!;

  try {
    await render();
    expect(rows()).toHaveLength(15);
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("1–15 / 18");
    expect(pageButton("上一页").disabled).toBe(true);
    await act(async () => pageButton("下一页").click());
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("16–18 / 18");
    expect(rows().map((row) => row.querySelector("strong [aria-hidden]")?.textContent)).toEqual([
      "48号 · 75㎡",
      "48号 · 100㎡",
      "48号 · 600㎡",
    ]);
    expect(rows()[0].querySelector("strong")?.title).toBe("老仓库48号—75㎡分区");
    expect(rows()[0].querySelector(`[title="${fullTenantName}"]`)?.textContent).toBe(
      fullTenantName,
    );
    expect(rows()[2].textContent).toContain("自用");
    expect(rows()[2].textContent).not.toContain("未登记");
    expect(pageButton("下一页").disabled).toBe(true);
    await act(async () => rows()[2].click());
    expect(onSelectAsset).toHaveBeenCalledWith("48-600");

    await render("old", "review");
    expect(rows()).toHaveLength(15);
    await act(async () => pageButton("下一页").click());
    await render("new", "review");
    expect(rows()).toHaveLength(1);
    await render("old", "review");
    expect(rows()).toHaveLength(15);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
