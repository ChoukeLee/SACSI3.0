import { expect, it } from "vitest";
import {
  classifyOperatingLeaseMode,
  leaseBrowseCategories,
  leaseBrowseCategoryLabel,
  leaseSearchHref,
  resolveLeaseBrowseView,
} from "./lease-browse-model";

it("presents three lease modes and classifies only separately identified sites as multi-unit", () => {
  expect(leaseBrowseCategories.map((mode) => leaseBrowseCategoryLabel(mode, "zh"))).toEqual([
    "公寓",
    "分单元出租",
    "整体出租",
  ]);
  expect(classifyOperatingLeaseMode({ group: "old_warehouse" })).toBe("multi-unit");
  expect(classifyOperatingLeaseMode({ group: "新仓库" })).toBe("multi-unit");
  expect(classifyOperatingLeaseMode({ group: "孵化园库房" })).toBe("multi-unit");
  expect(
    classifyOperatingLeaseMode({ group: "旧名称", sourceKey: "old_warehouse:48:partition_600sqm" }),
  ).toBe("multi-unit");
  expect(classifyOperatingLeaseMode({ group: "仓库" })).toBe("whole");
  expect(classifyOperatingLeaseMode({ group: "老仓库等", sourceKey: "warehouse:guoji" })).toBe(
    "whole",
  );
  expect(classifyOperatingLeaseMode({ group: "孵化园宿舍" })).toBe("multi-unit");
  expect(classifyOperatingLeaseMode({ group: "宿舍", name: "孵化园配套宿舍（四组明细）" })).toBe(
    "multi-unit",
  );
  expect(classifyOperatingLeaseMode({ group: "宿舍", name: "老公司宿舍" })).toBe("whole");
  expect(classifyOperatingLeaseMode({ group: "VALLON" })).toBe("whole");
});

it("translates existing category links and remembered preferences into the new modes", () => {
  expect(resolveLeaseBrowseView({}, "warehouse").category).toBe("multi-unit");
  expect(resolveLeaseBrowseView({ assetCategory: "commercial" }, "warehouse")).toMatchObject({
    category: "whole",
    rememberCategory: true,
  });
  expect(
    resolveLeaseBrowseView({ assetCategory: "warehouse", operatingAsset: "asset" }),
  ).toMatchObject({
    category: "multi-unit",
    rememberCategory: false,
  });
  expect(resolveLeaseBrowseView({ assetCategory: "followup" }, "whole").category).toBe("followup");
  expect(resolveLeaseBrowseView({ contract: "contract" }, "whole").category).toBe("apartment");
  expect(leaseSearchHref("fr", "multi-unit", "Q-1")).toBe(
    "/fr/leases?assetCategory=multi-unit&q=Q-1",
  );
});
