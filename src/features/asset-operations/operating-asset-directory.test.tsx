// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildLeaseRoomOverview } from "@/features/leases/lease-room-overview-model";
import type { LeaseContractRow } from "@/types/database";
import { workspaceContract, workspaceFixture } from "../../../tests/fixtures/contract-workspace";
import type { AssetOperationAsset, AssetOperationEntry } from "./asset-operations-model";
import { OperatingAssetDirectory } from "./operating-asset-directory";
import {
  buildOperatingAssetDirectory,
  type OperatingAssetDirectoryOptions,
} from "./operating-asset-directory-model";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const projectId = "test-sacsi";
const today = "2026-11-09";
const workbook =
  "sha256:e3ed7762344e6e731633bd753702308c51c6a4d24559ee520065ab947d9b16c6|file:公寓、仓库租金截止日期等.xlsx|sheet:老仓库等";
const octoberSource = `${workbook}|cell:I77|event:1`;
const juneSource = `${workbook}|range:H77`;

function asset(overrides: Partial<AssetOperationAsset> = {}): AssetOperationAsset {
  return {
    id: "test-land-id",
    projectId,
    unitId: null,
    sourceKey: "warehouse:guoji",
    code: "TEST-GUOJI",
    name: "国基仓库（原表国基租金）",
    group: "独立仓库",
    verification: "pending",
    sourceRefs: [`${workbook}|range:A77:G77`, "用户于2026-11-09确认独立仓库"],
    monthlyRentNative: null,
    rentCurrency: null,
    costCoverageThrough: null,
    updatedAt: "2026-11-09T00:00:00Z",
    ...overrides,
  };
}

type Entry = AssetOperationEntry & { bookedAmountXof?: number | null };

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "test-entry-id",
    assetId: "test-land-id",
    kind: "income",
    category: "rent",
    amountNative: 25000000,
    currency: "XOF",
    cashDate: "2026-10-02",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    verification: "pending",
    recognitionMethod: "unallocated",
    sourceRef: octoberSource,
    description: "原表为国基仓库租金。后续领取按原记录另核。",
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.localStorage.clear();
  navigation.push.mockClear();
  vi.unstubAllGlobals();
});

function directory(
  assets: AssetOperationAsset[],
  entries: Entry[],
  leaseEvidence?: OperatingAssetDirectoryOptions["leaseEvidence"],
) {
  return buildOperatingAssetDirectory(
    { projectId, assets, entries, canWrite: false },
    {
      sacsiProjectId: projectId,
      applyExcelConfirmation: true,
      leaseEvidence,
      today,
    },
  );
}

function dialog() {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  expect(dialogs).toHaveLength(1);
  return dialogs[0];
}

async function clickButton(scope: ParentNode, name: string) {
  const button = [...scope.querySelectorAll("button")].find((item) => item.textContent === name);
  expect(button, `button ${name}`).toBeDefined();
  await act(async () => button!.click());
}

function factValues(scope: ParentNode, name: string) {
  return [...scope.querySelectorAll("dt")]
    .filter((item) => item.textContent === name)
    .map((item) => item.nextElementSibling?.textContent);
}

it("opens the same confirmed Guoji receipts from the directory card and the land category", async () => {
  const data = directory(
    [asset()],
    [
      entry(),
      entry({
        id: "test-june-entry",
        amountNative: 50000000,
        cashDate: "2026-06-30",
        periodStart: "2026-01-01",
        periodEnd: "2026-06-30",
        sourceRef: juneSource,
      }),
    ],
  );
  await act(async () =>
    root.render(<OperatingAssetDirectory data={data} locale="zh" today={today} category="all" />),
  );
  const card = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  expect(card?.textContent).toContain("国基土地");
  expect(card?.textContent).not.toContain("资料待核");
  expect(card?.textContent).not.toContain("历史流水待核");
  expect(card?.textContent).toContain("季租2,500 万西法");
  expect(card?.textContent).toContain("已交至2026-09-30");
  expect(card?.textContent).toContain("查看资料");
  expect(card?.textContent).not.toContain("月租");
  await act(async () => card!.click());
  expect(card?.getAttribute("aria-pressed")).toBe("true");

  async function inspectHistory() {
    const current = dialog();
    expect(current.querySelector("h2")?.textContent).toBe("国基土地");
    expect(current.textContent).not.toContain("来源待核");
    expect(current.textContent).toContain("租金来源记载至 2026-09-30 · 已确认");
    expect(current.textContent).toContain("原币实收与支出");
    expect(current.textContent).toContain("本期暂无已核经营记账额。");
    expect(current.textContent).not.toContain("逾期");
    expect(factValues(current, "已核实收")).toEqual([]);
    await clickButton(current, "收付款");
    expect(current.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("收付款");
    expect(factValues(current, "收付日期")).toEqual(["2026-10-02", "2026-06-30"]);
    expect(factValues(current, "原币金额")).toEqual(["2,500 万西法", "5,000 万西法"]);
    expect(
      [...current.querySelectorAll('[data-status="verified"]')].map((item) => item.textContent),
    ).toEqual(["已确认", "已确认"]);
    expect([...current.querySelectorAll("summary")].map((item) => item.title)).toEqual([
      octoberSource,
      juneSource,
    ]);
    expect(current.textContent).not.toContain("国基仓库");
    await clickButton(current, "资料");
    expect(factValues(current, "季租")).toEqual(["2,500 万西法"]);
    await clickButton(current, "历史");
    expect(current.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("历史");
    expect(current.textContent).toContain("2026-07-01 — 2026-09-30");
    expect(current.textContent).toContain("2026-01-01 — 2026-06-30");
  }

  await inspectHistory();
  await act(async () =>
    root.render(
      <OperatingAssetDirectory
        data={data}
        locale="zh"
        today={today}
        category="land"
        selectedAssetId="test-land-id"
      />,
    ),
  );
  await inspectHistory();
});

it("only shows confirmed, completed rent periods as operating asset history", async () => {
  const data = directory(
    [asset()],
    [
      entry({ id: "pending", sourceRef: "unreviewed source" }),
      entry({ id: "voided", voidedAt: today }),
      entry({ id: "future", periodEnd: "2027-02-28" }),
      entry({ id: "nonrent", category: "property_fee" }),
    ],
  );
  await act(async () =>
    root.render(
      <OperatingAssetDirectory
        data={data}
        locale="zh"
        today={today}
        category="land"
        selectedAssetId="test-land-id"
      />,
    ),
  );
  const current = dialog();
  await clickButton(current, "历史");
  expect(current.textContent).toContain("暂无带有明确期间的已确认历史租金流水。");
  expect(current.querySelectorAll("li")).toHaveLength(0);
});

it("separates registered late payments from missing evidence and keeps warehouse cards grouped", async () => {
  const warehouse = (number: number, group: string) =>
    asset({
      id: `${group}-${number}`,
      sourceKey: `${group}:${number}`,
      name: `${group}${number}号`,
      group: group === "老仓库" ? "old_warehouse" : "new_warehouse",
      sourceRefs: [`${workbook}|range:A${number}:G${number}`],
      monthlyRentNative: 400000,
      rentCurrency: "XOF",
    });
  const late = warehouse(2, "老仓库");
  const upcoming = warehouse(10, "老仓库");
  const missing = warehouse(1, "新仓库");
  const vacant = warehouse(3, "新仓库");
  const evidence = (item: AssetOperationAsset, dueDate: string, unpaid?: boolean) => ({
    assetSourceRef: item.sourceRefs[0],
    paidThrough: { date: "2026-10-31", sourceRef: item.sourceRefs[0] },
    nextPayment: { dueDate, sourceRef: item.sourceRefs[0], unpaid },
  });
  const data = directory([upcoming, late, vacant, missing, asset()], [entry()], {
    [late.sourceKey!]: {
      ...evidence(late, "2026-11-07", true),
      outstanding: { amountNative: 400000, currency: "XOF", sourceRef: late.sourceRefs[0] },
      tenantEvidence: {
        names: ["示例租户甲", "示例租户乙"],
        sourceRef: `${workbook}|cell:C2`,
        classification: "historical",
        scope: "group",
        asOfSourceDate: "2026-10-31",
      },
    },
    [upcoming.sourceKey!]: {
      ...evidence(upcoming, "2026-11-22", true),
      tenantEvidence: {
        names: ["示例公司"],
        sourceRef: `${workbook}|cell:C10`,
        classification: "latest_source",
        scope: "asset",
      },
    },
    [missing.sourceKey!]: evidence(missing, "2026-11-10"),
  });

  await act(async () =>
    root.render(
      <OperatingAssetDirectory
        data={data}
        locale="zh"
        today={today}
        category="all"
        initialView="collections"
        enableCollections
      />,
    ),
  );
  const panel = host.querySelector('[aria-label="集中收款跟进"]')!;
  expect(panel).not.toBeNull();
  const rowTexts = () =>
    [...panel.querySelectorAll('button[aria-haspopup="dialog"]')].map((row) => row.textContent);
  expect(rowTexts()).toHaveLength(4);
  expect(rowTexts().find((text) => text?.includes("国基土地"))).toContain("待补资料");
  expect(panel.textContent).not.toContain("新仓库3号");

  const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  const searchByTenant = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        value,
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await searchByTenant("示例租户乙");
  expect(rowTexts()).toEqual([expect.stringContaining("历史合租租户 示例租户甲、示例租户乙")]);
  await searchByTenant("");

  await clickButton(panel, "已逾期1");
  expect(rowTexts()).toEqual([expect.stringContaining("老仓库2号")]);
  expect(rowTexts()[0]).toContain("付款日 2026-11-07");
  expect(rowTexts()[0]).toContain("40 万西法原表余款");
  await clickButton(panel, "15天内应缴1");
  expect(rowTexts()).toEqual([expect.stringContaining("登记租户 示例公司")]);
  await clickButton(panel, "待补资料2");
  expect(rowTexts()).toEqual(
    expect.arrayContaining([
      expect.stringContaining("国基土地"),
      expect.stringContaining("新仓库1号"),
    ]),
  );
  const landRow = [
    ...panel.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]'),
  ].find((row) => row.textContent?.includes("国基土地"));
  await act(async () => landRow!.click());
  expect(dialog().querySelector("h2")?.textContent).toBe("国基土地");

  await act(async () =>
    root.render(
      <OperatingAssetDirectory
        data={data}
        locale="zh"
        today={today}
        category="warehouse"
        enableCollections
        collectionHref="/leases?assetCategory=followup&collectionCategory=warehouse"
      />,
    ),
  );
  const oldGroup = [...host.querySelectorAll("h2")]
    .find((heading) => heading.textContent === "老仓库")
    ?.closest("section");
  expect([...oldGroup!.querySelectorAll("strong")].map((heading) => heading.textContent)).toEqual([
    "老仓库2号",
    "老仓库10号",
  ]);
  expect([...host.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
    "老仓库",
    "新仓库",
  ]);
  const filters = host.querySelector('[aria-label="长租状态筛选"]')!;
  expect([...filters.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "全部资产4",
    "已逾期1",
    "15天内应缴1",
    "待核事项1",
  ]);
  expect(host.querySelector("a[href*='collectionCategory=warehouse']")?.textContent).toBe(
    "收款跟进",
  );
  await clickButton(filters, "已逾期1");
  expect(host.querySelectorAll('button[aria-haspopup="dialog"]')).toHaveLength(1);
  expect(host.textContent).toContain("逾期 2 天");
  const scope = host.querySelector<HTMLSelectElement>('select[aria-label="资产分组"]')!;
  await act(async () => {
    scope.value = "新仓库";
    scope.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(filters.textContent).toContain("已逾期0");
  expect(host.querySelectorAll('button[aria-haspopup="dialog"]')).toHaveLength(0);
  await act(async () => {
    scope.value = "";
    scope.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await clickButton(filters, "全部资产4");
  const currentOldGroup = [...host.querySelectorAll("h2")]
    .find((heading) => heading.textContent === "老仓库")
    ?.closest("section");
  const lateCard = [...currentOldGroup!.querySelectorAll("button")].find((card) =>
    card.textContent?.includes("老仓库2号"),
  );
  expect(lateCard?.textContent).toContain("历史合租租户示例租户甲、示例租户乙");
  await act(async () => lateCard!.click());
  const tenantDetail = dialog();
  expect(factValues(tenantDetail, "历史合租租户")).toEqual(["示例租户甲、示例租户乙"]);
  await clickButton(tenantDetail, "资料");
  expect(factValues(tenantDetail, "租户记录日期")).toEqual(["2026-10-31"]);
  expect(factValues(tenantDetail, "租户依据")[0]).toContain("C2");

  await act(async () =>
    root.render(
      <OperatingAssetDirectory
        data={data}
        locale="zh"
        today={today}
        category="all"
        collectionHref="/leases?assetCategory=followup"
        apartmentRows={[]}
      />,
    ),
  );
  const categoryScope = host.querySelector<HTMLSelectElement>('select[aria-label="资产类别"]')!;
  await act(async () => {
    categoryScope.value = "land";
    categoryScope.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelector("a[href*='collectionCategory=land']")?.textContent).toBe("收款跟进");
  const combinedSearch = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      combinedSearch,
      "不存在的示例名称",
    );
    combinedSearch.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.textContent).toContain("未找到符合条件的资产。");
});

it("restores the last operating location per viewer and category without a second scope row", async () => {
  const data = directory(
    [
      asset(),
      asset({ id: "old", sourceKey: "old:1", name: "老仓库1号", group: "old_warehouse" }),
      asset({ id: "new", sourceKey: "new:1", name: "新仓库1号", group: "new_warehouse" }),
    ],
    [],
  );
  const renderCategory = async (category: "land" | "warehouse", viewerId = "viewer-a") =>
    act(async () =>
      root.render(
        <OperatingAssetDirectory
          data={data}
          locale="zh"
          today={today}
          category={category}
          browseViewerId={viewerId}
        />,
      ),
    );
  const location = () => host.querySelector<HTMLSelectElement>('select[aria-label="选择场地"]')!;
  const cards = () => host.querySelectorAll('button[aria-haspopup="dialog"]');

  await renderCategory("warehouse");
  const toolbar = host.querySelector('[aria-label="长租浏览工具栏"]')!;
  expect(toolbar.querySelector("select")).not.toBeNull();
  expect(toolbar.contains(location())).toBe(true);
  expect(toolbar.querySelector("option[value='all']")).toBeNull();
  expect(host.querySelectorAll('input[type="search"]')).toHaveLength(1);
  expect(host.querySelector('select[aria-label="资产分组"]')).toBeNull();
  expect(cards()).toHaveLength(2);

  await act(async () => {
    const selected = location();
    selected.value = "新仓库";
    selected.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(cards()).toHaveLength(1);
  expect(cards()[0].textContent).toContain("新仓库1号");

  await renderCategory("land");
  expect(location().value).toBe("");
  await renderCategory("warehouse");
  expect(location().value).toBe("新仓库");
  expect(cards()).toHaveLength(1);
  await renderCategory("warehouse", "viewer-b");
  expect(location().value).toBe("");
  expect(cards()).toHaveLength(2);
});

it("shows only matching assets from all categories and keeps search as the apartment detail return", async () => {
  const fixture = workspaceFixture();
  const apartmentRows = buildLeaseRoomOverview({
    units: fixture.units,
    contracts: fixture.contracts as LeaseContractRow[],
    customers: fixture.customers,
    buildings: fixture.buildings,
    today,
  });
  const data = directory(
    [
      asset(),
      asset({
        id: "warehouse",
        name: "示例仓库",
        sourceKey: "old:1",
        group: "old_warehouse",
        code: "SYNTHETIC-W",
      }),
    ],
    [],
  );
  const renderSearch = async (searchQuery: string) =>
    act(async () =>
      root.render(
        <OperatingAssetDirectory
          data={data}
          locale="zh"
          today={today}
          category="all"
          browseViewerId="viewer-a"
          apartmentRows={apartmentRows}
          searchCategory="warehouse"
          searchQuery={searchQuery}
        />,
      ),
    );

  await renderSearch(" ");
  expect(host.querySelector('[data-room-id], button[aria-haspopup="dialog"]')).toBeNull();
  await renderSearch("synthetic");
  expect(host.textContent).toContain("跨类别搜索结果2 项");
  expect(host.textContent).toContain("示例仓库");
  expect(host.textContent).not.toContain("国基土地");
  expect(host.querySelector('select[aria-label="选择场地"]')).toBeNull();
  expect(host.querySelector("a[href='/leases?assetCategory=followup']")).not.toBeNull();

  const room = host.querySelector<HTMLButtonElement>("button[data-room-id]")!;
  await act(async () => room.click());
  const next = new URL(navigation.push.mock.calls[0][0], "https://test.invalid");
  expect(next.searchParams.get("contract")).toBe(workspaceContract);
  expect(next.searchParams.get("returnTo")).toBe("/leases?assetCategory=warehouse&q=synthetic");
});

it("shows original currency and XOF book values separately for the same two cash movements", async () => {
  const office = asset({
    id: "test-office-id",
    sourceKey: "legacy_company:office",
    name: "示例办公室",
    group: "老公司出租",
    verification: "verified",
  });
  const data = directory(
    [office],
    [
      entry({
        id: "test-cny-entry",
        assetId: office.id,
        cashDate: "2026-11-06",
        currency: "CNY",
        amountNative: 504000,
        bookedAmountXof: 42000000,
        verification: "verified",
        sourceRef: "test.xlsx!H97",
        description: "人民币实收及西法记账依据",
      }),
      entry({
        id: "test-xof-entry",
        assetId: office.id,
        cashDate: "2026-11-05",
        amountNative: 1000000,
        verification: "verified",
        sourceRef: "test.xlsx!A2",
        description: "西法实收",
      }),
    ],
  );
  await act(async () =>
    root.render(
      <OperatingAssetDirectory
        data={data}
        locale="zh"
        today={today}
        category="all"
        selectedAssetId={office.id}
      />,
    ),
  );
  const current = dialog();
  const basis = (label: string) => {
    const heading = [...current.querySelectorAll("h4")].find((item) => item.textContent === label);
    expect(heading?.parentElement).toBeDefined();
    return heading!.parentElement!;
  };
  expect(factValues(basis("原币实收与支出"), "已核实收").sort()).toEqual([
    "100 万西法",
    "¥504,000",
  ]);
  expect(factValues(basis("西法记账额"), "已核实收")).toEqual(["4,300 万西法"]);

  await clickButton(current, "收付款");
  expect(factValues(current, "收付日期")).toEqual(["2026-11-06", "2026-11-05"]);
  expect(factValues(current, "原币金额")).toEqual(["¥504,000", "100 万西法"]);
  expect(factValues(current, "西法记账额")).toEqual(["4,200 万西法", "100 万西法"]);
});
