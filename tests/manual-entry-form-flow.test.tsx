// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  refresh: vi.fn(),
  pending: vi.fn(),
  saved: vi.fn(),
  request: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/finance/actions", () => ({ addLedgerEntry: mocks.add }));
vi.mock("@/features/finance/finance-request", () => ({ runFinanceRequest: mocks.request }));
import { ManualEntryForm } from "@/features/finance/manual-entry-form";
let host: HTMLDivElement, root: Root;
const buildings = [
  { id: "b1", display_name: "第一楼栋", code: "B1" },
  { id: "b2", display_name: "第二楼栋", code: "B2" },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.add.mockResolvedValue({ success: true });
  mocks.request.mockImplementation((_operation, _target, _payload, submit) =>
    submit("stable-operation-id"),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(props: Partial<React.ComponentProps<typeof ManualEntryForm>> = {}) {
  await act(async () =>
    root.render(
      <ManualEntryForm
        buildings={buildings}
        units={[{ id: "u1", building_id: "b1", unit_no: "101" }]}
        zh
        buildingId="b1"
        onPendingChange={mocks.pending}
        onSaved={mocks.saved}
        {...props}
      />,
    ),
  );
}
async function submit() {
  const form = host.querySelector("form")!;
  (form.elements.namedItem("amount") as HTMLInputElement).value = "123.45";
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
describe("bare manual finance form", () => {
  it("uses the explicit scope and original request identity, then closes only on success", async () => {
    await render();
    await submit();
    expect(mocks.request).toHaveBeenCalledWith(
      "manual_entry",
      "b1",
      expect.objectContaining({
        buildingId: "b1",
        amount: 123.45,
        currency: "XOF",
        exchangeRateToXof: 1,
      }),
      expect.any(Function),
    );
    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "stable-operation-id", buildingId: "b1" }),
    );
    expect(mocks.pending.mock.calls).toEqual([[true], [false]]);
    expect(mocks.saved).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(host.querySelector("details")).toBeNull();
    expect(host.querySelectorAll("select:not([name])")).toHaveLength(0);
  });
  it("keeps failed form contents and does not close or claim success", async () => {
    mocks.add.mockResolvedValue({ success: false, error: "结果未知，请按原内容重试" });
    await render();
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("结果未知");
    expect((host.querySelector('input[name="amount"]') as HTMLInputElement).value).toBe("123.45");
    expect(mocks.saved).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("rejects duplicate clicks while saving and reports pending state to its only shell", async () => {
    let finish!: (value: { success: boolean }) => void;
    mocks.add.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await submit();
    await submit();
    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.pending).toHaveBeenCalledExactlyOnceWith(true);
    expect(host.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
    await act(async () => finish({ success: true }));
    expect(mocks.pending).toHaveBeenLastCalledWith(false);
  });
  it("clears stale unit selection when standalone building selection changes", async () => {
    await render({ buildingId: undefined });
    const select = host.querySelector('select[name="unitId"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "u1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const building = host.querySelector("select:not([name])") as HTMLSelectElement;
    await act(async () => {
      building.value = "b2";
      building.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.value).toBe("");
    await submit();
    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({ buildingId: "b2", unitId: undefined }),
    );
  });
});
