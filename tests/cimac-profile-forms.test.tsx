// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnitRow } from "@/types/database";
import type { CustomerDirectoryProfile } from "@/features/customers/customer-directory-model";
const mocks = vi.hoisted(() => ({
  oldCustomer: vi.fn(),
  oldUnit: vi.fn(),
  save: vi.fn(),
  saved: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/features/customers/actions", () => ({
  createCustomer: mocks.oldCustomer,
  updateCustomer: mocks.oldCustomer,
}));
vi.mock("@/features/units/actions", () => ({ updateUnitStatus: mocks.oldUnit }));
vi.mock("@/components/ui/operational", () => ({
  RightDrawer: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <section role="dialog" aria-label={title}>
      {children}
    </section>
  ),
}));
import { CustomerWorkbenchForm } from "@/features/customers/customer-workbench-form";
import { UnitConditionEditor } from "@/features/units/unit-condition-editor";
let host: HTMLDivElement, root: Root;
const customer = {
  id: "customer",
  name: "Existing Customer",
  phone: "+2251234",
  notes: "Existing note",
  hasDocument: true,
  updated_at: "old",
} as CustomerDirectoryProfile;
const unit = {
  id: "asset",
  unit_no: "101",
  updated_at: "version",
  status: "available",
  operational_condition: "normal",
  occupancy_verified: true,
  construction_status: "operational",
} as UnitRow;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.save.mockResolvedValue({ success: true, data: { id: customer.id } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function renderCustomer() {
  await act(async () =>
    root.render(
      <CustomerWorkbenchForm
        profile={customer}
        locale="zh"
        saveAction={mocks.save}
        scopeNote="此处修改共享客户身份，不改合同、账务及项目关系。"
        onClose={mocks.close}
        onSaved={mocks.saved}
      />,
    ),
  );
}
async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
describe("CIMAC reuses focused forms without mounting old workspaces", () => {
  it("explains shared identity and saves through the scoped action only", async () => {
    await renderCustomer();
    expect(host.querySelectorAll("form")).toHaveLength(1);
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.querySelector('[role="note"]')?.textContent).toContain("共享客户身份");
    await submit();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: customer.name, phone: customer.phone }),
    );
    expect(mocks.save.mock.calls[0][0]).not.toHaveProperty("document_no_plain");
    expect(mocks.oldCustomer).not.toHaveBeenCalled();
    expect(mocks.saved).toHaveBeenCalledExactlyOnceWith(customer.id, false);
  });
  it("does not navigate or report success on a scope or concurrency error", async () => {
    mocks.save.mockResolvedValue({ success: false, error: "资料已变化，请刷新" });
    await renderCustomer();
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("资料已变化");
    expect(mocks.saved).not.toHaveBeenCalled();
    expect(host.querySelector("button[type=submit]")?.hasAttribute("disabled")).toBe(false);
  });
  it("guards rapid duplicate saves while a write is pending", async () => {
    let finish!: (value: unknown) => void;
    mocks.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderCustomer();
    await act(async () => {
      const form = host.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.save).toHaveBeenCalledOnce();
    await act(async () => finish({ success: true, data: { id: customer.id } }));
    expect(mocks.saved).toHaveBeenCalledOnce();
  });
  it("does not let a late save close a newly mounted customer form", async () => {
    let finish!: (value: unknown) => void;
    mocks.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderCustomer();
    await submit();
    await act(async () =>
      root.render(
        <CustomerWorkbenchForm
          key="new-target"
          profile={{ ...customer, id: "other", name: "Other Customer" }}
          locale="zh"
          saveAction={mocks.save}
          onClose={mocks.close}
          onSaved={mocks.saved}
        />,
      ),
    );
    await act(async () => finish({ success: true, data: { id: customer.id } }));
    expect(mocks.saved).not.toHaveBeenCalled();
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("Other Customer");
  });
  it("uses the scoped condition action while preserving the original RPC arguments", async () => {
    await act(async () =>
      root.render(
        <UnitConditionEditor
          unit={unit}
          locale="zh"
          buildingName="CIMAC A"
          canEdit
          saveAction={mocks.save}
          onClose={mocks.close}
          onStatusChanged={mocks.saved}
        />,
      ),
    );
    await act(async () =>
      (host.querySelector('input[value="maintenance"]') as HTMLInputElement).click(),
    );
    await submit();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(unit.id, "maintenance", unit.updated_at);
    expect(mocks.oldUnit).not.toHaveBeenCalled();
    expect(mocks.saved).toHaveBeenCalledOnce();
  });
});
