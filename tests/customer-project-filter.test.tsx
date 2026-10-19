// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/features/customers/actions", () => ({ createCustomer: vi.fn(), updateCustomer: vi.fn() }));
import { CustomerList, type CustomerBuildingSummary } from "@/features/customers/customer-list";
import type { CustomerRow } from "@/types/database";

let host: HTMLDivElement;
let root: Root;
const sacsi = { id: "sacsi", code: "SACSI", label: "SACSI" };
const cimac = { id: "cimac", code: "CIMAC", label: "CIMAC" };
// Deliberately misleading names: scope must come from the stored project relation.
const apartment: CustomerBuildingSummary = { id: "a", code: "A", label: "3#公寓", project: sacsi };
const otherApartment: CustomerBuildingSummary = { id: "a2", code: "A2", label: "11#公寓", project: sacsi };
const shop: CustomerBuildingSummary = { id: "c", code: "C", label: "第一栋", project: cimac };
const customers = ["Apartment", "Shop", "Shared", "Unassigned"].map((name) => ({
  id: name, name, is_blacklisted: false,
}) as CustomerRow);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function render(locale: "zh" | "fr" = "zh") {
  await act(async () => root.render(<CustomerList locale={locale} customers={customers} canEdit={false}
    buildingOptions={[shop, apartment, otherApartment]}
    customerBuildings={{ Apartment: [apartment], Shop: [shop], Shared: [otherApartment, shop] }}
    customerSegments={{ leaseCustomerIds: ["Apartment", "Shop", "Shared"], saleCustomerIds: [], dailyCustomerIds: [] }}
    customerProjectSegments={{
      sacsi: { leaseCustomerIds: ["Apartment"], saleCustomerIds: ["Shared"], dailyCustomerIds: [] },
      cimac: { leaseCustomerIds: ["Shop", "Shared"], saleCustomerIds: [], dailyCustomerIds: [] },
    }} />));
}
function nav(label: string) { return host.querySelector(`nav[aria-label="${label}"]`)!; }
function button(container: Element, text: string) {
  const result = [...container.querySelectorAll("button")].find((element) => element.textContent === text);
  expect(result, text).toBeTruthy(); return result!;
}
async function click(element: Element) { await act(async () => (element as HTMLButtonElement).click()); }

it("defaults to apartments and only shows their buildings and customers", async () => {
  await render();
  expect(nav("楼栋切换").textContent).toContain("3#公寓");
  expect(nav("楼栋切换").textContent).not.toContain("第一栋");
  expect(host.textContent).toContain("Apartment");
  expect(host.textContent).not.toContain("Shop");
  expect(host.textContent).not.toContain("Unassigned");
  expect(host.textContent).toContain("2 / 2 位客户");
});

it("switches projects, resets a stale building and keeps shared customers", async () => {
  await render();
  await click(button(nav("楼栋切换"), "3#公寓"));
  expect(host.textContent).toContain("1 / 2 位客户");
  await click(button(nav("项目切换"), "科建建材城"));
  expect((host.querySelector('select[aria-label="选择楼栋"]') as HTMLSelectElement).value).toBe("__all__");
  expect(nav("楼栋切换").textContent).toBe("全部楼栋第一栋");
  expect(host.textContent).toContain("Shop");
  expect(host.textContent).toContain("Shared");
  expect(host.textContent).not.toContain("Apartment");
  expect(nav("客户类型").textContent).toContain("长租客户2");
});

it("classifies a shared customer by the selected project's business", async () => {
  await render();
  expect(nav("客户类型").textContent).toContain("购房客户1");
  await click(button(nav("项目切换"), "科建建材城"));
  expect(nav("客户类型").textContent).toContain("购房客户0");
});

it("keeps customers without a project accessible without guessing their scope", async () => {
  await render();
  await click(button(nav("项目切换"), "未归属项目"));
  expect(host.textContent).toContain("Unassigned");
  expect(host.textContent).not.toContain("Apartment");
  expect(host.textContent).not.toContain("Shop");
  expect(host.textContent).toContain("1 / 1 位客户");
});

it("supports the mobile building selector", async () => {
  await render();
  const select = host.querySelector('select[aria-label="选择楼栋"]') as HTMLSelectElement;
  await act(async () => { select.value = "a2"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).toContain("Shared");
  expect(host.textContent).not.toContain("Apartment");
});

it("provides the same two-level controls in French", async () => {
  await render("fr");
  expect(nav("Choix du projet").textContent).toContain("Résidences SACSI");
  await click(button(nav("Choix du projet"), "CIMAC"));
  expect(nav("Choix du bâtiment").textContent).not.toContain("3#公寓");
  expect(host.textContent).toContain("2 / 2 clients");
});
