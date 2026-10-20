// @vitest-environment jsdom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import type { DailyWorkbenchActionsProps } from "@/features/daily-rentals/daily-workbench-actions";
import {
  calendarBuilding,
  calendarOtherBuilding,
  calendarWindowFixture,
} from "./fixtures/calendar-window";

const mocks = vi.hoisted(() => ({
  panel: vi.fn(),
  refresh: vi.fn(),
  completeCleaning: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function Panel(props: Record<string, unknown>) {
      mocks.panel(props);
      return (
        <div data-booking-panel>
          <button onClick={props.onChanged as () => void}>SAVE</button>
          <button onClick={props.onClose as () => void}>CLOSE PANEL</button>
        </div>
      );
    },
}));
vi.mock("@/components/ui/operational", () => ({
  RightDrawer: ({
    title,
    children,
    footer,
    onClose,
  }: {
    title: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    onClose: () => void;
  }) => (
    <div role="dialog">
      <h2>{title}</h2>
      {children}
      {footer}
      <button onClick={onClose}>CLOSE</button>
    </div>
  ),
}));
vi.mock("@/features/daily-rentals/actions", () => ({ completeCleaning: mocks.completeCleaning }));

import { DailyWorkbenchActions } from "@/features/daily-rentals/daily-workbench-actions";
import {
  DAILY_DATA_CHANGED,
  notifyDailyDataChanged,
} from "@/features/daily-rentals/daily-read-invalidation";

const room = {
  id: "room-101",
  building_id: calendarBuilding,
  code: "11-101",
  unit_no: "101",
  floor_label: "1",
  kind: "apartment",
  status: "available",
  daily_rental_enabled: true,
  operational_condition: "normal",
  area_sqm: null,
  layout: null,
  furnishing: null,
  notes: null,
  created_at: "2026-10-01",
  updated_at: "2026-10-01",
} as UnitRow;
const order = {
  id: "booking-a",
  unit_id: room.id,
  customer_id: "customer-a",
  guest_name: "Latest guest",
  check_in: "2026-10-19",
  check_out: "2026-10-23",
  actual_check_out: null,
  checkout_mode: "fixed",
  nightly_price_xof: 40_000,
  total_amount_xof: 160_000,
  prepaid_amount_xof: 40_000,
  billing_status: "partially_paid",
  manual_discount_amount_xof: 0,
  manual_discount_reason: null,
  final_amount_xof: null,
  status: "checked_in",
  ota_source: null,
  notes: null,
  created_at: "2026-10-01",
  updated_at: "2026-10-01",
} satisfies DailyBookingRow;

let host: HTMLDivElement;
let root: Root;
let props: DailyWorkbenchActionsProps;
const fetchMock = vi.fn();
function contextResult(url: string, overrides: Parameters<typeof calendarWindowFixture>[0] = {}) {
  const query = new URL(url, "https://example.test").searchParams;
  const currentRoom = { ...room, building_id: query.get("buildingId")! };
  return calendarWindowFixture({
    buildingId: query.get("buildingId")!,
    from: query.get("from")!,
    to: query.get("to")!,
    today: "2026-10-20",
    dailyUnits: [currentRoom],
    unitLookupUnits: [currentRoom],
    bookings: [order],
    bookingCount: 1,
    payments: [
      {
        id: "payment-a",
        source_id: order.id,
        amount: 40_000,
        payment_date: "2026-10-19",
        reversal_of_payment_id: null,
        request_kind: null,
      },
    ],
    paymentCount: 1,
    customers: [
      {
        id: order.customer_id,
        name: "Agent",
        phone: null,
        is_blacklisted: false,
        has_active_lease_contract: false,
        has_active_sale_contract: false,
      },
    ],
    customerCount: 1,
    ...overrides,
  });
}
const response = (data: unknown) => ({ ok: true, json: async () => data });
async function render(overrides: Partial<DailyWorkbenchActionsProps> = {}) {
  props = { ...props, ...overrides };
  await act(async () => root.render(<DailyWorkbenchActions {...props} />));
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
const lastPanel = () => mocks.panel.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  vi.clearAllMocks();
  fetchMock.mockReset();
  mocks.completeCleaning.mockReset();
  fetchMock.mockImplementation(async (url: string) => response(contextResult(url)));
  mocks.completeCleaning.mockResolvedValue({
    success: true,
    taskId: "clean-a",
    unitId: room.id,
    unitStatus: "available",
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    unit: room,
    booking: order,
    date: "2026-10-20",
    open: true,
    onClose: vi.fn(),
    onChanged: vi.fn(),
    locale: "zh",
    userRole: "admin",
    buildingId: calendarBuilding,
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("daily workbench operation adapter", () => {
  it("does not load operation context or mount the heavy panel while closed", async () => {
    await render({ open: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.panel).not.toHaveBeenCalled();
    await render({ open: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
    expect(lastPanel().booking).toMatchObject({ id: order.id, guest_name: "Latest guest" });
    expect(lastPanel().payments).toHaveLength(1);
    expect(lastPanel().customers).toHaveLength(1);
  });

  it("uses latest verified booking fields, not stale values from the selected row", async () => {
    await render({ booking: { ...order, status: "confirmed", guest_name: "Stale guest" } });
    expect(lastPanel().booking).toMatchObject({ status: "checked_in", guest_name: "Latest guest" });
    const query = new URL(fetchMock.mock.calls[0][0], "https://example.test").searchParams;
    expect(query.get("from")).toBe(order.check_in);
    expect(query.get("to")).toBe("2026-10-20");
  });

  it("passes the entire searched stay to the booking form without reducing it to one night", async () => {
    await render({ booking: null, checkOut: "2026-10-25" });
    expect(lastPanel()).toMatchObject({
      unitId: room.id,
      defaultDate: "2026-10-20",
      defaultCheckOut: "2026-10-25",
      backfillMode: false,
      readOnly: false,
    });
  });

  it("preserves the daily capability and configured price missing from generic lookup units", async () => {
    fetchMock.mockImplementationOnce(async (url: string) =>
      response(
        contextResult(url, {
          dailyUnits: [{ ...room, status: "sold", daily_rental_price_xof: 65_000 } as UnitRow],
          unitLookupUnits: [{ ...room, status: "sold", daily_rental_enabled: undefined }],
        }),
      ),
    );
    await render({ booking: null });
    expect(lastPanel().units[0]).toMatchObject({
      status: "sold",
      daily_rental_enabled: true,
      daily_rental_price_xof: 65_000,
    });
  });

  it("does not create another order after the room's daily capability is disabled", async () => {
    fetchMock.mockImplementationOnce(async (url: string) =>
      response(
        contextResult(url, {
          dailyUnits: [{ ...room, daily_rental_enabled: false }],
          unitLookupUnits: [{ ...room, daily_rental_enabled: undefined }],
        }),
      ),
    );
    await render({ booking: null });
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(host.textContent).toContain("尚未启用日租业务");
  });

  it("keeps non-operator viewers readonly and admin-only check-in correction separate", async () => {
    await render({ userRole: "boss" });
    expect(lastPanel()).toMatchObject({ readOnly: true, canCorrectCheckin: false });
    await render({ userRole: "front_desk" });
    expect(lastPanel()).toMatchObject({ readOnly: false, canCorrectCheckin: false });
    await render({ userRole: "admin" });
    expect(lastPanel().canCorrectCheckin).toBe(true);
  });

  it("blocks unauthorized creation and admin-only historical backfill", async () => {
    await render({ booking: null, userRole: "front_desk" });
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(host.textContent).toContain("无创建预订权限");
    await render({ unit: null, userRole: "rental_sales" });
    expect(mocks.panel).not.toHaveBeenCalled();
    await render({ userRole: "admin" });
    expect(lastPanel()).toMatchObject({ backfillMode: true, unitId: null });
  });

  it.each([401, 403, 500])(
    "fails closed after HTTP %s and allows a fresh retry",
    async (status) => {
      fetchMock.mockResolvedValueOnce({ ok: false, status });
      await render();
      expect(host.querySelector("[role=alert]")).not.toBeNull();
      expect(mocks.panel).not.toHaveBeenCalled();
      await click("重新核对");
      expect(lastPanel().booking.id).toBe(order.id);
    },
  );

  it("rejects missing customers, missing target booking, and another building's response", async () => {
    for (const overrides of [
      { customers: undefined, customerCount: undefined },
      { bookings: [], bookingCount: 0 },
      { buildingId: calendarOtherBuilding },
    ]) {
      fetchMock.mockImplementationOnce(async (url: string) =>
        response(contextResult(url, overrides)),
      );
      await render({ open: true });
      expect(host.querySelector("[role=alert]")).not.toBeNull();
      expect(mocks.panel).not.toHaveBeenCalled();
      await render({ open: false });
    }
  });

  it("never trusts an already-selected room from a different building", async () => {
    await render({ unit: { ...room, building_id: calendarOtherBuilding } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
  });

  it("aborts and ignores a delayed previous building response after switching scope", async () => {
    let resolveOld!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await render();
    const originalUrl = fetchMock.mock.calls[0][0];
    await render({
      buildingId: calendarOtherBuilding,
      unit: { ...room, building_id: calendarOtherBuilding },
    });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(lastPanel().units[0].building_id).toBe(calendarOtherBuilding);
    await act(async () => resolveOld(response(contextResult(originalUrl))));
    expect(lastPanel().units[0].building_id).toBe(calendarOtherBuilding);
  });

  it("invalidates all daily readers and notifies the workbench after audited panel operations", async () => {
    const events: Event[] = [];
    const listener = (event: Event) => events.push(event);
    window.addEventListener(DAILY_DATA_CHANGED, listener);
    try {
      await render();
      await click("SAVE");
      expect(props.onChanged).toHaveBeenCalledTimes(1);
      expect((events[0] as CustomEvent).detail.buildingId).toBe(calendarBuilding);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(DAILY_DATA_CHANGED, listener);
    }
  });

  it("clears stale payment actions during relevant invalidation, not unrelated-building events", async () => {
    await render();
    await act(async () => notifyDailyDataChanged(calendarOtherBuilding));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    let complete!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await act(async () => notifyDailyDataChanged(calendarBuilding));
    expect(host.querySelector("[data-booking-panel]")).toBeNull();
    expect(host.querySelector("[role=status]")).not.toBeNull();
    await act(async () => complete({ ok: false, status: 403 }));
    expect(host.querySelector("[data-booking-panel]")).toBeNull();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
  });

  it("requires explicit cleaning confirmation and delegates only to the existing audited action", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      response(
        contextResult(url, {
          cleaningTasks: [
            { id: "clean-a", unit_id: room.id, daily_booking_id: null, is_completed: false },
          ],
        }),
      ),
    );
    await render({ booking: null, userRole: "front_desk" });
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(mocks.completeCleaning).not.toHaveBeenCalled();
    await click("保洁已完成");
    expect(mocks.completeCleaning).toHaveBeenCalledExactlyOnceWith("clean-a");
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a cleaning failure without pretending success", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      response(
        contextResult(url, {
          cleaningTasks: [
            { id: "clean-a", unit_id: room.id, daily_booking_id: null, is_completed: false },
          ],
        }),
      ),
    );
    mocks.completeCleaning.mockResolvedValueOnce({
      success: false,
      error: "cleaningTaskAlreadyCompleted",
    });
    await render({ booking: null });
    await click("保洁已完成");
    expect(host.querySelector("[role=alert]")?.textContent).toContain("该保洁任务已完成");
    expect(props.onChanged).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("uses existing creation policy to refuse maintenance, locked and past ordinary bookings", async () => {
    for (const condition of ["maintenance", "locked"] as const) {
      fetchMock.mockImplementationOnce(async (url: string) =>
        response(
          contextResult(url, {
            dailyUnits: [{ ...room, operational_condition: condition }],
            unitLookupUnits: [{ ...room, operational_condition: condition }],
          }),
        ),
      );
      await render({ booking: null, open: true });
      expect(host.querySelector("[role=alert]")).not.toBeNull();
      expect(mocks.panel).not.toHaveBeenCalled();
      await render({ open: false });
    }
    await render({ open: true, date: "2026-10-19" });
    expect(host.textContent).toContain("不能创建过去日期");
    expect(mocks.panel).not.toHaveBeenCalled();
  });
});
