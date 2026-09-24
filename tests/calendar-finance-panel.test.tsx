// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import {
  CalendarFinancePanel,
  type CalendarFinancePanelProps,
} from "@/features/daily-rentals/calendar-finance-panel";
import type { DailyBookingRow, UnitRow } from "@/types/database";

it("opens exactly the selected unpaid booking without submitting financial changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onOpenBooking = vi.fn(),
    onClose = vi.fn(),
    fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const booking: DailyBookingRow = {
    id: "unpaid-order",
    unit_id: "room",
    customer_id: "agent",
    status: "checked_out",
    check_in: "2026-09-01",
    check_out: "2026-09-03",
    actual_check_out: "2026-09-03",
    nightly_price_xof: 10000,
    total_amount_xof: 20000,
    final_amount_xof: 20000,
    prepaid_amount_xof: 10000,
    checkout_mode: "fixed",
    billing_status: "partially_paid",
    manual_discount_amount_xof: 0,
    manual_discount_reason: null,
    ota_source: null,
    notes: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-03T00:00:00Z",
  };
  const props: CalendarFinancePanelProps = {
    financeDetail: "outstanding",
    locale: "zh",
    todayStr: "2026-09-23",
    financeStats: {
      monthCollected: 0,
      currentOutstanding: 10000,
      monthSettled: 0,
      collectedPayments: [],
      outstandingBookings: [booking],
      settledBookings: [],
    },
    collectedPaymentGroups: [],
    allUnitById: new Map([["room", { id: "room", unit_no: "1102" } as UnitRow]]),
    customerMap: new Map(),
    onClose,
    onOpenBooking,
  };
  try {
    await act(async () => root.render(<CalendarFinancePanel {...props} />));
    const button = host.querySelector(
      'button[aria-label="查看房间1102未结订单"]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => button.click());
    expect(onOpenBooking).toHaveBeenCalledExactlyOnceWith("unpaid-order");
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
