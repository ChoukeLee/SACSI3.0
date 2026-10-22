// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { UnitRow } from "@/types/database";

const { submit, request } = vi.hoisted(() => ({ submit: vi.fn(), request: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/daily-rentals/actions", () => ({ createBackfillBooking: submit }));
vi.mock("@/features/finance/finance-request", () => ({ runFinanceRequest: request }));
vi.mock("@/components/ui/operational", () => ({
  RightDrawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  controlClass: "",
}));
vi.mock("@/features/daily-rentals/daily-customer-select", () => ({
  DailyCustomerSelect: ({ onChange }: { onChange: (value: string) => void }) => (
    <select aria-label="经办人" onChange={(event) => onChange(event.target.value)}>
      <option value="">选择</option>
      <option value="agent">黄姐</option>
    </select>
  ),
}));
vi.mock("@/components/ui/date-input", () => ({
  DateInput: ({
    value,
    onChangeValue,
    ...props
  }: {
    value: string;
    onChangeValue: (value: string) => void;
  }) => (
    <input
      {...props}
      type="date"
      value={value}
      onChange={(event) => onChangeValue(event.target.value)}
    />
  ),
}));
import { BookingPanel } from "@/features/daily-rentals/booking-panel";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T09:00:00Z"));
  submit.mockReset().mockResolvedValue({ success: true });
  request.mockReset().mockImplementation((_op, _unit, _payload, send) => send("stable-request"));
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
async function set(selector: string, value: string) {
  await act(async () => {
    const input = host.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    const prototype =
      input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }),
    );
  });
}
async function fill() {
  await act(async () =>
    root.render(
      <BookingPanel
        booking={null}
        unitId={null}
        units={[
          { id: "unit", unit_no: "204", building_id: "building", floor_label: "2F" } as UnitRow,
        ]}
        customers={[]}
        payments={[]}
        cleaningTasks={[]}
        locale="zh"
        backfillMode
        onClose={() => {}}
        onChanged={() => {}}
      />,
    ),
  );
  await set("#backfill-unit", "unit");
  await set('[aria-label="经办人"]', "agent");
  await set('input[type="date"]', "2026-10-21");
  host.querySelectorAll('input[type="date"]')[1].setAttribute("data-checkout", "true");
  await set('[data-checkout="true"]', "2026-10-22");
  await set('input[type="number"]', "80000");
  const numbers = host.querySelectorAll('input[type="number"]');
  numbers[1].setAttribute("data-paid", "true");
  await set('[data-paid="true"]', "80000");
  await set('[aria-label="补录原因"]', "补录昨日已完成住宿");
}
async function clickConfirm() {
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "确认补录")!
      .click(),
  );
}
it("waits for a deliberate confirmation and sends actual cash date separately from checkout", async () => {
  await fill();
  await set("#backfill-payment-date", "2026-10-21");
  await set("#backfill-payment-method", "cash");
  expect(submit).not.toHaveBeenCalled();
  await clickConfirm();
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      unitId: "unit",
      customerId: "agent",
      checkIn: "2026-10-21",
      checkOut: "2026-10-22",
      nightlyPriceXof: 80000,
      prepaidAmountXof: 80000,
      paymentDate: "2026-10-21",
      paymentMethod: "cash",
      requestId: "stable-request",
    }),
  );
});
it("does not default to checkout date or cash when facts have not been supplied", async () => {
  await fill();
  await clickConfirm();
  expect(host.textContent).toContain("请填写实际收款日期和方式");
  expect(submit).not.toHaveBeenCalled();
});
it("rejects a fractional price rather than silently rounding it", async () => {
  await fill();
  await set('input[type="number"]', "80000.5");
  await clickConfirm();
  expect(host.textContent).toContain("请核对整数日价");
  expect(submit).not.toHaveBeenCalled();
});
