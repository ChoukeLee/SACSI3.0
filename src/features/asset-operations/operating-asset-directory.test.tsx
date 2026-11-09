// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssetOperationAsset, AssetOperationEntry } from "./asset-operations-model";
import { OperatingAssetDirectory } from "./operating-asset-directory";
import { buildOperatingAssetDirectory } from "./operating-asset-directory-model";

const projectId = "test-sacsi";
const today = "2026-11-09";

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
    sourceRefs: ["test.xlsx!A77:G77", "用户于2026-11-09确认独立仓库"],
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
    sourceRef: "test.xlsx!I77",
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
  vi.unstubAllGlobals();
});

function directory(assets: AssetOperationAsset[], entries: Entry[]) {
  return buildOperatingAssetDirectory(
    { projectId, assets, entries, canWrite: false },
    {
      sacsiProjectId: projectId,
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

it("opens the same corrected land detail from the directory card and the land-category selection", async () => {
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
        sourceRef: "test.xlsx!H77",
      }),
    ],
  );
  await act(async () =>
    root.render(<OperatingAssetDirectory data={data} locale="zh" today={today} category="all" />),
  );
  const card = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  expect(card?.textContent).toContain("国基土地");
  expect(card?.textContent).toContain("2 笔历史流水待核");
  expect(card?.textContent).toContain("租金来源记载至 2026-09-30 · 待核");
  await act(async () => card!.click());

  async function inspectHistory() {
    const current = dialog();
    expect(current.querySelector("h2")?.textContent).toBe("国基土地");
    expect(current.textContent).toContain("本期 0 笔，全部历史 2 笔");
    expect(current.textContent).toContain("租金来源记载至 2026-09-30 · 待核");
    expect(current.textContent).toContain("原币实收与支出");
    expect(current.textContent).toContain("本期暂无已核经营记账额。");
    expect(current.textContent).not.toContain("逾期");
    expect(factValues(current, "已核实收")).toEqual([]);
    await clickButton(current, "查看待核流水");
    expect(current.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("收付款");
    expect(factValues(current, "收付日期")).toEqual(["2026-10-02", "2026-06-30"]);
    expect(factValues(current, "原币金额")).toEqual(["2,500 万西法", "5,000 万西法"]);
    expect([...current.querySelectorAll("summary")].map((item) => item.title)).toEqual([
      "test.xlsx!I77",
      "test.xlsx!H77",
    ]);
    expect(current.textContent).not.toContain("国基仓库");
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
