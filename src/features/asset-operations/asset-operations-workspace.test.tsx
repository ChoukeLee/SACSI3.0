import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetOperationsWorkspace } from "./asset-operations-workspace";
import { assetReportPeriod, type AssetOperationsData } from "./asset-operations-model";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./asset-operations-actions", () => ({
  confirmAssetOperationAsset: vi.fn(),
  confirmAssetOperationEntry: vi.fn(),
  createAssetOperationEntry: vi.fn(),
  importAssetOperationCatalog: vi.fn(),
  voidAssetOperationEntry: vi.fn(),
  updateAssetOperationTerms: vi.fn(),
  importAssetOperationEntries: vi.fn(),
}));

const data: AssetOperationsData = {
  projectId: "project",
  canWrite: false,
  assets: [
    {
      id: "asset",
      projectId: "project",
      unitId: null,
      code: "OLD-1",
      name: "Warehouse 1",
      group: "old_warehouse",
      verification: "verified",
      sourceRefs: ["inventory.xlsx!A2:I2"],
      monthlyRentNative: 375000,
      rentCurrency: "XOF",
      costCoverageThrough: null,
      updatedAt: "2026-11-07T00:00:00Z",
    },
  ],
  entries: [
    {
      id: "cash",
      assetId: "asset",
      kind: "income",
      category: "rent",
      amountNative: 100.5,
      currency: "XOF",
      cashDate: "2026-11-05",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      recognitionMethod: "unallocated",
      verification: "verified",
      sourceRef: "receipt-1",
      description: "Verified receipt",
    },
  ],
};

function render(value: AssetOperationsData, locale: "zh" | "fr" = "zh") {
  return renderToStaticMarkup(
    <AssetOperationsWorkspace
      data={value}
      locale={locale}
      initialPeriod={assetReportPeriod("month", "2026-11")}
      today="2026-11-07"
      canImport={false}
    />,
  );
}

describe("asset pilot report presentation", () => {
  it("preserves fractional XOF, shows allocation uncertainty, and keeps write controls out of read-only reports", () => {
    const html = render(data);
    expect(html).toContain("100.5 XOF");
    expect(html).toContain("成本资料完整性未确认");
    expect(html).toContain("暂不分摊");
    expect(html).not.toContain("保存记录");
    expect(html).not.toContain("核实此记录");
    expect(html).not.toContain("导入为待核档案");
  });

  it("does not turn a pending source amount or monthly rent standard into confirmed cash", () => {
    const html = render({
      ...data,
      entries: [{ ...data.entries[0], verification: "pending", amountNative: 777777 }],
    });
    expect(html).toContain("所选期间暂无可纳入的已核实收支记录");
    expect(html).not.toContain("已录现金收入");
    expect(html).toContain("777,777 XOF");
    expect(html).toContain("月租标准（测算）");
  });

  it("renders the French report with the same source and uncertainty boundaries", () => {
    const html = render(data, "fr");
    expect(html).toContain("Exhaustivité des coûts non confirmée");
    expect(html).toContain("100,5 XOF");
    expect(html).toContain("receipt-1");
    expect(html).toContain("Non réparti");
  });
});
