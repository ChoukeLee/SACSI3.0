// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/features/daily-rentals/actions", () => ({ completeCleaning: vi.fn() }));
vi.mock("@/features/daily-rentals/booking-panel", () => ({
  BookingPanel: () => <div data-booking-panel />,
}));
import { DailyCalendar } from "@/features/daily-rentals/calendar";
import { formatXof } from "@/lib/utils";
import type { DailyBookingRow, UnitRow } from "@/types/database";

let root: Root, host: HTMLDivElement;
const writeText = vi.fn(),
  print = vi.fn();
const today = new Date().toISOString().slice(0, 10);
const unit = {
  id: "unit",
  building_id: "building",
  unit_no: "9998",
  floor_label: "9",
  kind: "apartment",
  status: "daily_occupied",
  daily_rental_enabled: true,
} as UnitRow;
const booking = {
  id: "booking",
  unit_id: "unit",
  customer_id: "guest",
  check_in: today,
  check_out: today,
  checkout_mode: "open",
  actual_check_out: null,
  status: "checked_in",
  nightly_price_xof: 100,
  prepaid_amount_xof: 0,
  total_amount_xof: 177777,
  final_amount_xof: 177777,
  manual_discount_amount_xof: 0,
} as DailyBookingRow;
const base: React.ComponentProps<typeof DailyCalendar> = {
  dailyUnits: [unit],
  unitLookupUnits: [unit],
  bookings: [booking],
  customers: [{ id: "guest", name: "合成窗口测试住客", phone: null, is_blacklisted: false }],
  payments: [],
  cleaningTasks: [],
  locale: "zh",
  userRole: "admin",
  buildingLabel: "合成楼栋",
  financeSnapshot: {
    today,
    month: today.slice(0, 7),
    cash: { gross: 188888, refund: 0, adjustment: 0, net: 188888, count: 1, excludedCount: 0 },
    includedPaymentIds: [],
    currentOutstanding: 177777,
    monthSettled: 199999,
  },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writeText.mockReset().mockResolvedValue(undefined);
  print.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  vi.spyOn(window, "print").mockImplementation(print);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "execCommand");
  Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((element) => element.textContent?.includes(label))!;
async function render(extra: Partial<React.ComponentProps<typeof DailyCalendar>> = {}) {
  await act(async () => root.render(<DailyCalendar {...base} {...extra} />));
}

it.each([{ windowPending: true }, { windowError: true }])(
  "hides stale overview/financial numbers and blocks copy, print and already-open finance details for %j",
  async (failure) => {
    await render();
    expect(host.textContent).toContain(formatXof(177777));
    await act(async () => button("在住订单未收").click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await render(failure);
    const overview = host.querySelector("section")!;
    expect(overview.textContent).toContain("房态与财务待刷新，暂不可核验");
    for (const amount of [177777, 188888, 199999])
      expect(host.textContent).not.toContain(formatXof(amount));
    expect(overview.textContent).not.toContain("9998");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(button("复制群消息").disabled).toBe(true);
    expect(button("打印").disabled).toBe(true);
    await act(async () => {
      button("复制群消息").click();
      button("打印").click();
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    expect(button("在住订单未收")).toBeUndefined();
    await render();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain(formatXof(177777));
    expect(button("复制群消息").disabled).toBe(false);
    expect(button("打印").disabled).toBe(false);
    await act(async () => {
      button("复制群消息").click();
      button("打印").click();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
  },
);

it("also reports an empty stale catalogue as unknown on failure, never as a verified no-rooms result", async () => {
  await render({ dailyUnits: [], windowError: true });
  expect(host.textContent).toContain("今日房态暂不可核验");
  expect(button("打印").disabled).toBe(true);
});

it("does not fall back to copying old room data if clipboard permission fails after the window becomes unknown", async () => {
  let rejectCopy!: (reason: Error) => void;
  writeText.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectCopy = reject;
      }),
  );
  const fallback = vi.fn();
  Object.defineProperty(document, "execCommand", { value: fallback, configurable: true });
  await render();
  await act(async () => button("复制群消息").click());
  await render({ windowError: true });
  await act(async () => rejectCopy(new Error("permission denied")));
  expect(fallback).not.toHaveBeenCalled();
  expect(button("复制群消息").disabled).toBe(true);
});
