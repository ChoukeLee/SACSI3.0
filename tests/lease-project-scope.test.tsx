// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/leases/actions", () => ({
  createLeaseContract: vi.fn(),
  activateContract: vi.fn(),
  terminateContract: vi.fn(),
  processMoveOut: vi.fn(),
  recordLeaseFinancialEntry: vi.fn(),
}));
import { LeaseList } from "@/features/leases/lease-list";
import {
  leaseScopeCookieName,
  leaseScopeStorageKey,
} from "@/features/contracts/lease-scope-preference";
import {
  groupLeaseBuildings,
  resolveBuildingScope,
  type LeaseBuilding,
} from "@/features/leases/project-scope";
import type { UnitRow, CustomerRow, LeaseContractRow } from "@/types/database";

const buildings: LeaseBuilding[] = [
  {
    id: "c1",
    code: "CIMAC-B01",
    display_name: "第一栋",
    project_id: "c",
    project: { id: "c", code: "CIMAC", display_name: "建材城" },
  },
  {
    id: "c2",
    code: "CIMAC-B02",
    display_name: "第二栋",
    project_id: "c",
    project: { id: "c", code: "CIMAC", display_name: "建材城" },
  },
  {
    id: "a11",
    code: "SACSI11",
    display_name: "11#公寓",
    project_id: "a",
    project: { id: "a", code: "SACSI", display_name: "公寓" },
  },
  {
    id: "a7",
    code: "SACSI7",
    display_name: "7#公寓",
    project_id: "a",
    project: { id: "a", code: "SACSI", display_name: "公寓" },
  },
];
const units = buildings.map((b) => ({
  id: b.id,
  building_id: b.id,
  unit_no: "101",
  floor_label: "1",
  status: "available",
})) as UnitRow[];
const customers = buildings.map((b) => ({
  id: b.id,
  name: `客户${b.id}`,
  is_blacklisted: false,
})) as CustomerRow[];
const contracts = buildings.map((b, i) => ({
  id: b.id,
  unit_id: b.id,
  customer_id: b.id,
  status: b.id === "a7" ? "terminated" : "active",
  start_date: "2026-01-01",
  expected_end_date: "2029-01-01",
  monthly_rent_xof: (i + 1) * 1000000,
  deposit_amount_xof: 3000000,
  paid_through_date: "2028-12-31",
  ...(b.id === "a7" ? { actual_end_date: "2026-02-01" } : {}),
})) as LeaseContractRow[];
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(initialProject?: string, browseViewerId?: string) {
  const cookieName = leaseScopeCookieName(browseViewerId);
  await act(async () =>
    root.render(
      <LeaseList
        initialProject={initialProject}
        browseViewerId={browseViewerId}
        scopePreference={cookieName ? { cookieName, serverResolved: false } : undefined}
        buildings={buildings}
        units={units}
        customers={customers}
        contracts={contracts}
        payments={[]}
        receivables={[]}
        locale="zh"
      />,
    ),
  );
}
async function clickNav(label: string, text: string) {
  const b = [...host.querySelectorAll(`nav[aria-label="${label}"] button`)].find(
    (b) => b.textContent === text,
  )!;
  expect(b).toBeTruthy();
  await act(async () => (b as HTMLButtonElement).click());
}
function metric(label: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label))
    ?.textContent;
}

it("scopes buildings, rental cards and rental counts together; remembers each project's building", async () => {
  await render();
  expect(host.querySelector('nav[aria-label="楼栋切换"]')?.textContent).not.toContain("第一栋");
  expect(host.textContent).toContain("客户a11");
  expect(host.textContent).not.toContain("客户c1");
  await clickNav("项目切换", "科建建材城");
  expect(host.querySelector('nav[aria-label="楼栋切换"]')?.textContent).not.toContain("11#公寓");
  expect(host.textContent).toContain("客户c1");
  expect(host.textContent).toContain("客户c2");
  expect(host.textContent).not.toContain("客户a11");
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(2);
  expect(metric("全部租赁")).toBe("全部租赁2");
  expect(host.querySelector("table")).toBeNull();
  expect(host.textContent).not.toContain("明细核对");
  expect(host.querySelector('[aria-label="第一栋 1F"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="第二栋 1F"]')).not.toBeNull();
  await clickNav("楼栋切换", "第二栋");
  expect(host.textContent).not.toContain("客户c1");
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(1);
  expect(metric("全部租赁")).toBe("全部租赁1");
  await clickNav("项目切换", "公寓项目");
  await clickNav("项目切换", "科建建材城");
  expect(host.textContent).not.toContain("客户c1");
  expect(host.textContent).toContain("客户c2");
  expect(JSON.parse(localStorage.getItem("lease-project-scope")!).buildings.c).toBe("c2");
});

it("limits new-contract options to selected project and building, with building labels", async () => {
  await render();
  await clickNav("项目切换", "科建建材城");
  await clickNav("楼栋切换", "第二栋");
  const button = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("登记租赁"),
  )!;
  await act(async () => button.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).toBeTruthy();
  const optionValues = [...dialog.querySelectorAll("select")][0].querySelectorAll("option");
  expect([...optionValues].map((o) => o.value)).toEqual(["", "c2"]);
  expect(optionValues[1].textContent).toContain("第二栋 · 101");
});

it("recovers stale saved scopes and uses database project membership instead of code prefixes", async () => {
  localStorage.setItem(
    "lease-project-scope",
    JSON.stringify({ projectId: "gone", buildings: { a: "c1" } }),
  );
  await render();
  expect(host.textContent).toContain("客户a11");
  expect(host.textContent).not.toContain("客户c1");
  expect(resolveBuildingScope([buildings[2]], "c1")).toBe("all");
  const groups = groupLeaseBuildings([{ ...buildings[0], code: "SACSI-LIKE-NAME" }, buildings[2]]);
  expect(groups.find((g) => g.id === "c")?.buildings[0].id).toBe("c1");
});

it("supports the mobile building selector", async () => {
  await render();
  await clickNav("项目切换", "科建建材城");
  const select = host.querySelector('select[aria-label="选择楼栋"]') as HTMLSelectElement;
  await act(async () => {
    select.value = "c1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.textContent).toContain("客户c1");
  expect(host.textContent).not.toContain("客户c2");
});

it("combines apartment location with shared browsing and remembers the selected building", async () => {
  const viewer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await render(undefined, viewer);
  const toolbar = host.querySelector('[aria-label="长租浏览工具栏"]')!;
  const select = toolbar.querySelector<HTMLSelectElement>('select[aria-label="选择项目或楼栋"]')!;
  expect(select.value).toBe("a11");
  expect(
    Array.from(
      toolbar.querySelectorAll('[aria-label="长租工作台"] a'),
      (entry) => entry.textContent,
    ),
  ).toEqual(["公寓", "分单元出租", "整体出租", "收款跟进"]);
  expect(host.querySelectorAll('input[type="search"]')).toHaveLength(1);
  expect(toolbar.querySelector('a[href="/leases?assetCategory=followup"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="楼栋切换"] [aria-current="true"]')?.textContent).toBe(
    "11#公寓",
  );
  expect(metric("查看历史")).toBe("查看历史");
  const room = host.querySelector<HTMLButtonElement>('[data-room-id="a11"]')!;
  expect(room.textContent).toContain("客户a11");
  expect(room.querySelector("time")?.dateTime).toBe("2028-12-31");
  expect(room.textContent).not.toMatch(/月租|万西法/);
  expect(metric("全部租赁")).toBe("全部租赁 1");
  expect(host.querySelector('select[aria-label="房源跟进筛选"]')).toBeNull();

  const back = host.querySelector<HTMLButtonElement>('button[aria-label="返回全部楼栋"]')!;
  await act(async () => back.click());
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(0);
  const index = host.querySelector('[aria-label="长租楼栋"]')!;
  expect(index.textContent).toContain("11#公寓");
  expect(index.textContent).toContain("1 间租赁房源");
  expect(index.textContent).not.toContain("第二栋");
  const historical = Array.from(index.querySelectorAll("button")).find((item) =>
    item.textContent?.includes("7#公寓"),
  )!;
  expect(historical.textContent).toContain("仅历史租赁");
  await act(async () => historical.click());
  const history = Array.from(host.querySelectorAll("button")).find(
    (item) => item.textContent === "查看历史",
  )!;
  await act(async () => history.click());
  expect(host.querySelector('[aria-label="租赁记录查询"]')?.textContent).toContain("客户a7");
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="返回全部楼栋"]')!.click(),
  );
  const building = Array.from(
    host.querySelectorAll<HTMLButtonElement>('[aria-label="长租楼栋"] button'),
  ).find((item) => item.textContent?.includes("11#公寓"))!;
  await act(async () => building.click());
  expect(host.querySelector('[data-room-id="a11"]')).not.toBeNull();
  expect(document.activeElement?.textContent).toBe("11#公寓");

  await act(async () => {
    select.value = "c2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.textContent).toContain("客户c2");
  expect(host.textContent).not.toContain("客户c1");
  expect(
    JSON.parse(localStorage.getItem(leaseScopeStorageKey(leaseScopeCookieName(viewer)))!).buildings
      .c,
  ).toBe("c2");

  await act(async () => root.unmount());
  root = createRoot(host);
  await render(undefined, viewer);
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="选择项目或楼栋"]')?.value).toBe(
    "c2",
  );
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(1);
});

it("opens an explicit project link across all its buildings instead of restoring a different remembered project", async () => {
  localStorage.setItem(
    "lease-project-scope",
    JSON.stringify({ projectId: "a", buildings: { a: "a11", c: "c2" } }),
  );
  await render("CIMAC");
  expect(host.textContent).toContain("客户c1");
  expect(host.textContent).toContain("客户c2");
  expect(host.textContent).not.toContain("客户a11");
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(2);
  expect(metric("全部租赁")).toBe("全部租赁2");
});
