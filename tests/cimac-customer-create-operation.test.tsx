// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/features/cimac/cimac-profile-actions", () => ({
  createCimacCustomerIdentity: mocks.create,
  updateCimacCustomerProfile: vi.fn(),
  updateCimacAssetCondition: vi.fn(),
}));
vi.mock("@/features/customers/actions", () => ({
  createCustomer: mocks.legacy,
  updateCustomer: mocks.legacy,
}));
// Resolve only this operation's lazy form synchronously; exercise the real reused form.
vi.mock("next/dynamic", async () => {
  const { CustomerWorkbenchForm } = await import("@/features/customers/customer-workbench-form");
  return { default: () => CustomerWorkbenchForm };
});
vi.mock("@/components/ui/operational", () => ({
  RightDrawer: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section role="dialog" aria-label={title}>
      {children}
    </section>
  ),
}));
import { CimacCustomerCreateOperation } from "@/features/cimac/cimac-profile-operations";
const id = "10000000-0000-4000-8000-000000000001";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.create.mockResolvedValue({ success: true, data: { id } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function open(locale: "zh" | "fr" = "zh", canCreateContract = true) {
  await act(async () =>
    root.render(
      <CimacCustomerCreateOperation locale={locale} canCreateContract={canCreateContract} />,
    ),
  );
  expect(host.querySelector("form")).toBeNull();
  await act(async () => host.querySelector("button")!.click());
}
async function name(value: string) {
  const input = host.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
describe("new CIMAC identity continues into the park contract flow", () => {
  it("explains no park relationship or bill is created and allows cancellation without writing", async () => {
    await open();
    expect(host.querySelector('[role="note"]')?.textContent).toContain("共享客户身份");
    expect(host.querySelector('[role="note"]')?.textContent).toContain("合同保存后才建立");
    expect(host.querySelector('[role="note"]')?.textContent).toContain("不创建合同、应收或收款");
    await act(async () =>
      [...host.querySelectorAll("button")].find((button) => button.textContent === "取消")!.click(),
    );
    expect(host.querySelector("form")).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it.each(["zh", "fr"] as const)(
    "saves through the scoped create action and preselects the new identity in %s contracts",
    async (locale) => {
      await open(locale);
      await name("Confirmed New Customer");
      await submit();
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ name: "Confirmed New Customer" }),
      );
      expect(mocks.legacy).not.toHaveBeenCalled();
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
        `${locale === "fr" ? "/fr" : ""}/cimac/contracts?customer=${id}`,
      );
      expect(host.querySelector("form")).toBeNull();
    },
  );
  it.each(["zh", "fr"] as const)(
    "keeps customer creation for %s financial users while explaining the read-only handoff",
    async (locale) => {
      await open(locale, false);
      const note = host.querySelector('[role="note"]')?.textContent;
      expect(note).toContain(
        locale === "zh" ? "当前账号没有建约权限" : "Ce compte ne peut pas créer de bail",
      );
      expect(note).toContain(locale === "zh" ? "租售账号或管理员" : "commercial ou administrateur");
      await name("Finance-created Customer");
      await submit();
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
        `${locale === "fr" ? "/fr" : ""}/cimac/contracts?customer=${id}`,
      );
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );
  it("keeps an invalid or rejected identity form open without navigating or claiming a park relationship", async () => {
    await open();
    await submit();
    expect(mocks.create).not.toHaveBeenCalled();
    await name("Confirmed New Customer");
    mocks.create.mockResolvedValue({ success: false, error: "Cannot save identity" });
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Cannot save identity");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(host.querySelector("form")).not.toBeNull();
  });
});
