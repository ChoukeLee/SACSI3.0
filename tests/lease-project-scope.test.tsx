// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/leases/actions", () => ({ createLeaseContract: vi.fn(), activateContract: vi.fn(), terminateContract: vi.fn(), processMoveOut: vi.fn(), recordLeaseFinancialEntry: vi.fn() }));
import { LeaseList } from "@/features/leases/lease-list";
import { groupLeaseBuildings, resolveBuildingScope, type LeaseBuilding } from "@/features/leases/project-scope";
import type { UnitRow, CustomerRow, LeaseContractRow } from "@/types/database";

const buildings: LeaseBuilding[] = [
  { id: "c1", code: "CIMAC-B01", display_name: "第一栋", project_id: "c", project: { id: "c", code: "CIMAC", display_name: "建材城" } },
  { id: "c2", code: "CIMAC-B02", display_name: "第二栋", project_id: "c", project: { id: "c", code: "CIMAC", display_name: "建材城" } },
  { id: "a11", code: "SACSI11", display_name: "11#公寓", project_id: "a", project: { id: "a", code: "SACSI", display_name: "公寓" } },
];
const units = buildings.map((b) => ({ id: b.id, building_id: b.id, unit_no: "101", floor_label: "1", status: "available" })) as UnitRow[];
const customers = buildings.map((b) => ({ id: b.id, name: `客户${b.id}`, is_blacklisted: false })) as CustomerRow[];
const contracts = buildings.map((b, i) => ({ id: b.id, unit_id: b.id, customer_id: b.id, status: "active", start_date: "2026-01-01", expected_end_date: "2029-01-01", monthly_rent_xof: (i + 1) * 1000000, deposit_amount_xof: 3000000, paid_through_date: "2028-12-31" })) as LeaseContractRow[];
let root: Root; let host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<LeaseList buildings={buildings} units={units} customers={customers} contracts={contracts} payments={[]} receivables={[]} locale="zh" />)); }
async function clickNav(label: string, text: string) { const b = [...host.querySelectorAll(`nav[aria-label="${label}"] button`)].find((b) => b.textContent === text)!; expect(b).toBeTruthy(); await act(async () => (b as HTMLButtonElement).click()); }
function metric(label: string) { return [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label))?.textContent; }

it("scopes buildings, contract cards and statistics together; remembers each project's building", async () => {
  await render();
  expect(host.querySelector('nav[aria-label="楼栋切换"]')?.textContent).not.toContain("第一栋");
  expect(host.textContent).toContain("客户a11");
  expect(host.textContent).not.toContain("客户c1");
  await clickNav("项目切换", "科建建材城");
  expect(host.querySelector('nav[aria-label="楼栋切换"]')?.textContent).not.toContain("11#公寓");
  expect(host.textContent).toContain("客户c1"); expect(host.textContent).toContain("客户c2"); expect(host.textContent).not.toContain("客户a11");
  expect(metric("生效合同")).toContain("2");
  expect(host.querySelectorAll("h3")).toHaveLength(2); // Same floor and room numbers stay separated by building.
  await clickNav("楼栋切换", "第二栋");
  expect(host.textContent).not.toContain("客户c1"); expect(metric("生效合同")).toContain("1");
  await clickNav("项目切换", "公寓项目"); await clickNav("项目切换", "科建建材城");
  expect(host.textContent).not.toContain("客户c1"); expect(host.textContent).toContain("客户c2");
  expect(JSON.parse(localStorage.getItem("lease-project-scope")!).buildings.c).toBe("c2");
});

it("limits new-contract options to selected project and building, with building labels", async () => {
  await render(); await clickNav("项目切换", "科建建材城"); await clickNav("楼栋切换", "第二栋");
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("新建合同"))!;
  await act(async () => button.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).toBeTruthy();
  const optionValues = [...dialog.querySelectorAll("select")][0].querySelectorAll("option");
  expect([...optionValues].map((o) => o.value)).toEqual(["", "c2"]);
  expect(optionValues[1].textContent).toContain("第二栋 · 101");
});

it("recovers stale saved scopes and uses database project membership instead of code prefixes", async () => {
  localStorage.setItem("lease-project-scope", JSON.stringify({ projectId: "gone", buildings: { a: "c1" } }));
  await render(); expect(host.textContent).toContain("客户a11"); expect(host.textContent).not.toContain("客户c1");
  expect(resolveBuildingScope([buildings[2]], "c1")).toBe("all");
  const groups = groupLeaseBuildings([{ ...buildings[0], code: "SACSI-LIKE-NAME" }, buildings[2]]);
  expect(groups.find((g) => g.id === "c")?.buildings[0].id).toBe("c1");
});

it("supports the mobile building selector", async () => {
  await render(); await clickNav("项目切换", "科建建材城");
  const select = host.querySelector('select[aria-label="选择楼栋"]') as HTMLSelectElement;
  await act(async () => { select.value = "c1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).toContain("客户c1"); expect(host.textContent).not.toContain("客户c2");
});
