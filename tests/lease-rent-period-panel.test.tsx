// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  correct: vi.fn(),
  identity: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/features/leases/actions", () => ({
  reviewLeaseRentPeriod: mocks.review,
  correctLeaseRentPeriod: mocks.correct,
}));
vi.mock("@/features/leases/lease-request-identity", () => ({
  leaseRequestIdentity: mocks.identity,
  clearLeaseRequestIdentity: mocks.clear,
}));
vi.mock("@/components/ui/date-input", () => ({
  DateInput: ({ value, onChangeValue }: { value: string; onChangeValue: (v: string) => void }) => (
    <input type="date" value={value} onChange={(e) => onChangeValue(e.target.value)} />
  ),
}));
import { LeaseRentPeriodCorrection } from "@/features/leases/lease-rent-period-correction";
let root: Root, host: HTMLDivElement;
const saved = vi.fn(),
  paymentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  receivableId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.review.mockResolvedValue({
    success: true,
    data: {
      contractId: "c",
      token: "a".repeat(32),
      paidThroughDate: "2026-08-26",
      payments: [
        {
          id: paymentId,
          paymentDate: "2026-07-27",
          amount: 700000,
          currency: "XOF",
          receiptNo: "Synthetic",
        },
      ],
      receivables: [
        { id: receivableId, title: "Synthetic paid rent", amountXof: 700000, periodEnd: null },
      ],
    },
  });
  mocks.identity.mockResolvedValue("stable-id");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<LeaseRentPeriodCorrection contractId="c" locale="zh" onSaved={saved} />),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
  await act(async () => button.click());
}
async function fill(selector: string, value: string) {
  const element = document.querySelector(selector) as HTMLInputElement;
  const proto =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
async function filled() {
  await click("更正租金账期");
  await fill("select:nth-of-type(1)", paymentId);
  const selects = [...document.querySelectorAll("select")];
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      selects[1],
      receivableId,
    );
    selects[1].dispatchEvent(new Event("change", { bubbles: true }));
  });
  await fill('input[type="date"]', "2026-06-30");
  await fill("textarea", "Explicit owner confirmation");
}
it("loads lazily and never auto-selects a receipt or paid bill", async () => {
  expect(mocks.review).not.toHaveBeenCalled();
  await click("更正租金账期");
  expect([...document.querySelectorAll("select")].map((s) => s.value)).toEqual(["", ""]);
  expect(mocks.correct).not.toHaveBeenCalled();
});
it("freezes unknown outcomes and reuses the exact request rather than writing twice", async () => {
  mocks.correct
    .mockResolvedValueOnce({ success: false, rejected: false, error: "Unknown" })
    .mockResolvedValueOnce({ success: true });
  await filled();
  await click("确认更正账期（不新增收款）");
  expect(document.querySelector("fieldset")?.disabled).toBe(true);
  await click("原样重试，核对原结果");
  expect(mocks.correct.mock.calls[1]).toEqual(mocks.correct.mock.calls[0]);
  expect(mocks.identity).toHaveBeenCalledTimes(1);
  expect(saved).toHaveBeenCalledTimes(1);
});
