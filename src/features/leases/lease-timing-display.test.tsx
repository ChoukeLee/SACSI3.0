// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CustomerRow, LeaseContractRow, UnitRow } from "@/types/database";
import type { LeaseBuilding } from "./project-scope";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  createLeaseContract: vi.fn(),
  activateContract: vi.fn(),
  terminateContract: vi.fn(),
  processMoveOut: vi.fn(),
  recordLeaseFinancialEntry: vi.fn(),
}));
vi.mock("@/features/print", () => ({ printLeaseContract: vi.fn() }));

import { LeaseList } from "./lease-list";
import { LeaseWorkbenchInspector } from "./lease-workbench-inspector";

const building = {
  id: "building-5",
  code: "SACSI5",
  display_name: "5#公寓",
  project_id: "project-1",
  project: { id: "project-1", code: "SACSI", display_name: "公寓" },
} as LeaseBuilding;
const contracts = [
  {
    id: "current-lease",
    unit_id: "current-unit",
    customer_id: "current-customer",
    contract_no: "CURRENT",
    status: "active",
    start_date: "2026-01-01",
    expected_end_date: "2026-07-16",
    monthly_rent_xof: 1_150_000,
    deposit_amount_xof: 2_300_000,
    payment_cycle: "monthly",
  },
  {
    id: "future-lease",
    unit_id: "future-unit",
    customer_id: "future-customer",
    contract_no: "FUTURE",
    status: "active",
    start_date: "2026-11-15",
    expected_end_date: "2030-02-14",
    monthly_rent_xof: 4_500_000,
    deposit_amount_xof: 9_000_000,
    payment_cycle: "semiannual",
  },
] as LeaseContractRow[];
const units = contracts.map((contract, index) => ({
  id: contract.unit_id,
  building_id: building.id,
  unit_no: `${index + 4}F`,
  floor_label: String(index + 4),
  status: "leased",
})) as UnitRow[];
const customers = contracts.map((contract, index) => ({
  id: contract.customer_id,
  name: index ? "待起租客户" : "已起租客户",
})) as CustomerRow[];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderList() {
  await act(async () =>
    root.render(
      <LeaseList
        buildings={[building]}
        contracts={contracts}
        units={units}
        customers={customers}
        payments={[]}
        receivables={[]}
        locale="zh"
        canCreate={false}
        canRecordFinance={false}
        canActivate={false}
        canMoveOut={false}
      />,
    ),
  );
}
async function click(text: string, selector = "button") {
  const target = [...host.querySelectorAll<HTMLButtonElement>(selector)].find(
    (button) => button.textContent === text,
  );
  expect(target).toBeTruthy();
  await act(async () => target!.click());
}

it("keeps future leases discoverable while excluding them from active count, rent and filter", async () => {
  await renderList();
  expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(host.querySelector("tbody")?.textContent).toContain("待起租");
  const activeMetric = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("生效合同"),
  );
  expect(activeMetric?.textContent).toContain("生效合同1");
  const rentMetric = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("月租规模"),
  );
  expect(rentMetric?.textContent).toContain("1,150,000");
  expect(rentMetric?.textContent).not.toContain("5,650,000");

  await click("生效中", 'nav[aria-label="合同状态筛选"] button');
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(host.querySelector("tbody")?.textContent).toContain("已起租客户");
  expect(host.querySelector("tbody")?.textContent).not.toContain("待起租客户");
  await click("全部", 'nav[aria-label="合同状态筛选"] button');
  expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
  await click("楼层房源");
  expect(host.textContent).toContain("待起租");
});

it("shows a future agreement as pending in both inspector languages without hiding deposit collection", async () => {
  for (const locale of ["zh", "fr"] as const) {
    await act(async () =>
      root.render(
        <LeaseWorkbenchInspector
          contract={contracts[1]}
          payments={[]}
          receivables={[]}
          today="2026-10-26"
          locale={locale}
          onPrint={vi.fn()}
          collectionHref="/leases/future-lease/collect"
        />,
      ),
    );
    expect(host.textContent).toContain(locale === "zh" ? "待起租" : "À venir");
    expect(host.textContent).toContain("2026-11-15");
    expect(host.querySelector('a[href="/leases/future-lease/collect"]')).toBeTruthy();
  }
});
