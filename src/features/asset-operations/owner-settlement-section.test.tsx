// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ownerAssetId,
  ownerContext,
  ownerInput,
  ownerSettlement,
} from "../../../tests/fixtures/owner-settlement";
import { OwnerSettlementSection } from "./owner-settlement-section";

const mocks = vi.hoisted(() => ({ context: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock("./owner-settlement-actions", () => ({
  getOwnerSettlementContext: mocks.context,
  recordOwnerSettlement: mocks.save,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mocks.context.mockResolvedValue({ ok: true, context: ownerContext() });
  mocks.save.mockResolvedValue({
    ok: false,
    error: "assetOperationResultUnknown",
    rejected: false,
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(canWrite: boolean, onUnresolvedChange = vi.fn()) {
  await act(async () =>
    root.render(
      <OwnerSettlementSection
        assetId={ownerAssetId}
        canWrite={canWrite}
        settlement={ownerSettlement()}
        today="2026-11-13"
        locale="zh"
        onUnresolvedChange={onUnresolvedChange}
      />,
    ),
  );
  return onUnresolvedChange;
}
async function openAndFill() {
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  const form = host.querySelector<HTMLFormElement>("form")!;
  const input = ownerInput();
  const values = {
    ownerName: input.ownerName,
    sharePercent: "25",
    amountNative: "5000000",
    cashDate: input.cashDate,
    paymentMethod: input.paymentMethod,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    openingWholeCredit: "1000000",
    closingWholeCredit: "0",
    sourceRef: input.sourceRef,
    reason: input.reason,
  };
  for (const [name, value] of Object.entries(values))
    form.querySelector<HTMLInputElement>(`[name='${name}']`)!.value = value;
  return form;
}
async function submit(form: HTMLFormElement) {
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

it("shows owner cash and the separate settlement period without giving a read-only user a write button", async () => {
  await render(false);
  expect(host.textContent).toContain("本次实收500 万西法");
  expect(host.textContent).toContain("本次分账结清期");
  expect(host.textContent).toContain("租客付款进度和其他期间待核款项分别保留");
  expect(host.querySelector("button")).toBeNull();
  expect(mocks.context).not.toHaveBeenCalled();
});

it("uses explicit whole-XOF inputs and previews actual cash separately from the whole-property equivalent", async () => {
  await render(true);
  const form = await openAndFill();
  expect(form.textContent).toContain("西法元（XOF）");
  expect(form.querySelector<HTMLInputElement>("[name='amountNative']")!.value).toBe("5000000");
  await submit(form);
  expect(host.textContent).toContain("本次实收 500 万西法 ÷ 25% = 整厂等值 2,000 万西法");
  expect(host.textContent).toContain("业主份额本期结清");
  expect(mocks.save.mock.calls[0][0]).toEqual(ownerInput());
});

it("freezes unknown input and retries exactly the original payload and ID even if the DOM is tampered with", async () => {
  const unresolved = await render(true);
  mocks.save.mockRejectedValueOnce(new Error("lost response"));
  mocks.save.mockImplementationOnce(async (_input, requestId) => ({
    ok: true,
    settlement: { ...ownerSettlement(), requestId },
    idempotent: true,
  }));
  const form = await openAndFill();
  await submit(form);
  expect(host.textContent).toContain("保存结果未确认");
  expect(form.querySelector("fieldset")!.disabled).toBe(true);
  expect(unresolved).toHaveBeenLastCalledWith(true);
  expect(mocks.refresh).not.toHaveBeenCalled();
  const first = mocks.save.mock.calls[0];
  form.querySelector<HTMLInputElement>("[name='amountNative']")!.value = "1";
  await submit(form);
  expect(mocks.save.mock.calls[1]).toEqual(first);
  expect(first[1]).toMatch(/^[0-9a-f-]{36}$/i);
  expect(unresolved).toHaveBeenLastCalledWith(false);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(host.querySelector("form")).toBeNull();
});

it("blocks a mismatched equation and fractional share conversion before dispatch", async () => {
  await render(true);
  const form = await openAndFill();
  form.querySelector<HTMLInputElement>("[name='closingWholeCredit']")!.value = "1";
  await submit(form);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(host.textContent).toContain("结算等式不平");
  form.querySelector<HTMLInputElement>("[name='closingWholeCredit']")!.value = "0";
  form.querySelector<HTMLInputElement>("[name='sharePercent']")!.value = "33.33";
  await submit(form);
  expect(mocks.save).not.toHaveBeenCalled();
});
