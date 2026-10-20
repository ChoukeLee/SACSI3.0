// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { UnitRow } from "@/types/database";
const mocks = vi.hoisted(() => ({ update: vi.fn(), close: vi.fn(), changed: vi.fn() }));
vi.mock("@/features/units/actions", () => ({ updateUnitStatus: mocks.update }));
vi.mock("@/components/ui/operational", () => ({
  RightDrawer: ({
    title,
    subtitle,
    children,
    onClose,
  }: {
    title: string;
    subtitle: string;
    children: React.ReactNode;
    onClose: () => void;
  }) => (
    <section role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <p>{subtitle}</p>
      <button type="button" onClick={onClose}>
        Close
      </button>
      {children}
    </section>
  ),
}));
import { UnitConditionEditor } from "@/features/units/unit-condition-editor";
const unit = {
  id: "unit-a",
  unit_no: "101",
  status: "sold",
  operational_condition: "normal",
  updated_at: "2026-10-20T08:00:00Z",
  occupancy_verified: true,
  construction_status: "operational",
} as UnitRow;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({ success: true });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(props: Partial<React.ComponentProps<typeof UnitConditionEditor>> = {}) {
  await act(async () =>
    root.render(
      <UnitConditionEditor
        unit={unit}
        buildingName="测试楼栋"
        locale="zh"
        canEdit
        onClose={mocks.close}
        onStatusChanged={mocks.changed}
        {...props}
      />,
    ),
  );
}
async function choose(value: string) {
  await act(async () =>
    (host.querySelector(`input[value="${value}"]`) as HTMLInputElement).click(),
  );
}
async function submit() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
describe("focused asset condition operation", () => {
  it("contains only the condition form, not a second dossier or history fetch", async () => {
    await render();
    expect(host.querySelectorAll("form")).toHaveLength(1);
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).not.toContain("完整资产档案");
    expect(host.textContent).toContain("本操作不改变权属、入住、合同或保洁状态");
    await submit();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("keeps original optimistic concurrency and maps normal to the existing available action", async () => {
    await render({ unit: { ...unit, operational_condition: "maintenance" } });
    await choose("normal");
    await submit();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(unit.id, "available", unit.updated_at);
    expect(mocks.changed).toHaveBeenCalledOnce();
  });
  it("saves maintenance through the same action, without changing ownership", async () => {
    await render();
    await choose("maintenance");
    await submit();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(unit.id, "maintenance", unit.updated_at);
  });
  it("blocks duplicate submits and drawer dismissal while an operation is pending", async () => {
    let finish!: (value: { success: boolean }) => void;
    mocks.update.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await choose("locked");
    await submit();
    await submit();
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Close")!
        .click(),
    );
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    await act(async () => finish({ success: true }));
    expect(mocks.changed).toHaveBeenCalledOnce();
  });
  it("retains failed selections and displays concurrency errors without claiming success", async () => {
    mocks.update.mockResolvedValue({ success: false, error: "房源已变化，请刷新后重试。" });
    await render();
    await choose("locked");
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("房源已变化");
    expect((host.querySelector('input[value="locked"]') as HTMLInputElement).checked).toBe(true);
    expect(mocks.changed).not.toHaveBeenCalled();
  });
  it("does not mount for read-only viewers and removes a mounted editor on revocation", async () => {
    await render();
    await render({ canEdit: false });
    expect(host.querySelector("form")).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("uses French labels and retains the readiness warning", async () => {
    await render({ locale: "fr", unit: { ...unit, occupancy_verified: false } });
    expect(host.textContent).toContain("Modifier l’état opérationnel");
    expect(host.textContent).toContain("Construction et occupation à vérifier");
  });
  it("resets the draft to the correct asset/version after a target change", async () => {
    await render();
    await choose("locked");
    await render({ unit: { ...unit, id: "unit-b", unit_no: "202", updated_at: "new-version" } });
    expect((host.querySelector('input[value="normal"]') as HTMLInputElement).checked).toBe(true);
    await choose("maintenance");
    await submit();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("unit-b", "maintenance", "new-version");
  });
  it("does not close or update a new target when an old save finishes late", async () => {
    let finish!: (value: { success: boolean }) => void;
    mocks.update.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await choose("locked");
    await submit();
    await render({ unit: { ...unit, id: "unit-b", unit_no: "202", updated_at: "new-version" } });
    await act(async () => finish({ success: true }));
    expect(mocks.changed).not.toHaveBeenCalled();
    expect(host.textContent).toContain("202");
    expect(host.querySelector("fieldset")?.disabled).toBe(false);
  });
});
