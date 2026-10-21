// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DailyBookingRow, UnitRow } from "@/types/database";

const { completeCleaning } = vi.hoisted(() => ({ completeCleaning: vi.fn() }));
vi.mock("@/features/daily-rentals/actions", () => ({ completeCleaning }));
vi.mock("@/features/daily-rentals/booking-panel", () => ({
  BookingPanel: (props: {
    booking: DailyBookingRow | null;
    unitId: string | null;
    defaultDate?: string;
    onClose: () => void;
  }) => (
    <div
      data-booking-panel
      data-booking-id={props.booking?.id ?? ""}
      data-unit-id={props.unitId ?? ""}
      data-default-date={props.defaultDate ?? ""}
      data-booking-status={props.booking?.status ?? ""}
      data-checkout={props.booking?.check_out ?? ""}
    >
      <button type="button" onClick={props.onClose}>
        Close test booking panel
      </button>
    </div>
  ),
}));

import { DailyCalendar } from "@/features/daily-rentals/calendar";

const unit: UnitRow = {
  id: "room-1202",
  building_id: "building-11",
  code: "SACSI-1202",
  unit_no: "1202",
  floor_label: "12F",
  kind: "apartment",
  status: "daily_occupied",
  daily_rental_enabled: true,
  area_sqm: null,
  layout: null,
  furnishing: null,
  notes: null,
  created_at: "",
  updated_at: "",
};
function currentBooking(overrides: Partial<DailyBookingRow> = {}): DailyBookingRow {
  return {
    id: "one-night-current",
    unit_id: unit.id,
    customer_id: "current-guest",
    check_in: "2026-10-20",
    check_out: "2026-10-21",
    checkout_mode: "fixed",
    actual_check_out: null,
    nightly_price_xof: 40000,
    total_amount_xof: 40000,
    prepaid_amount_xof: 0,
    billing_status: "need_top_up",
    manual_discount_amount_xof: 0,
    manual_discount_reason: null,
    final_amount_xof: null,
    status: "checked_in",
    ota_source: null,
    notes: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}
function futureBooking(): DailyBookingRow {
  return currentBooking({
    id: "future-reservation",
    customer_id: "future-guest",
    check_in: "2026-10-23",
    check_out: "2026-10-27",
    total_amount_xof: 160000,
    status: "confirmed",
  });
}

let root: Root;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  completeCleaning.mockClear();
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

async function render(bookings: DailyBookingRow[], locale: "zh" | "fr" = "zh") {
  await act(async () =>
    root.render(
      <DailyCalendar
        dailyUnits={[unit]}
        bookings={bookings}
        customers={[
          { id: "current-guest", name: "Niamke", phone: null, is_blacklisted: false },
          { id: "future-guest", name: "Future guest", phone: null, is_blacklisted: false },
        ]}
        cleaningTasks={[]}
        payments={[]}
        locale={locale}
        userRole="admin"
        buildingLabel="11#"
      />,
    ),
  );
}
function guestButtons(name: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="gridcell"] button[title]')].filter(
    (button) => button.title.startsWith(`${name} ·`),
  );
}
function panel() {
  return host.querySelector<HTMLDivElement>("[data-booking-panel]")!;
}
async function closePanel() {
  await act(async () => panel().querySelector("button")!.click());
}

it("keeps today's pending departure visible without hiding a future reservation or its empty preceding day", async () => {
  const bookings = [currentBooking(), futureBooking()];
  const original = structuredClone(bookings);
  await render(bookings);

  expect(guestButtons("Niamke")).toHaveLength(1);
  expect(guestButtons("Niamke")[0].textContent).toContain("今日待退房");
  expect(host.querySelector('button[aria-label="1202 2026-10-21"]')).toBeNull();
  expect(guestButtons("Future guest").length).toBeGreaterThan(0);

  await act(async () => guestButtons("Future guest")[0].click());
  expect(panel().dataset.bookingId).toBe("future-reservation");
  expect(panel().dataset.checkout).toBe("2026-10-27");
  await closePanel();

  const emptyFutureCell = host.querySelector<HTMLButtonElement>(
    'button[aria-label="1202 2026-10-22"]',
  );
  expect(emptyFutureCell).not.toBeNull();
  await act(async () => emptyFutureCell!.click());
  expect(panel().dataset.bookingId).toBe("");
  expect(panel().dataset.unitId).toBe(unit.id);
  expect(panel().dataset.defaultDate).toBe("2026-10-22");
  await closePanel();

  await act(async () => guestButtons("Niamke")[0].click());
  expect(panel().dataset.bookingId).toBe("one-night-current");
  expect(panel().dataset.bookingStatus).toBe("checked_in");
  expect(panel().dataset.checkout).toBe("2026-10-21");
  expect(bookings).toEqual(original);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(completeCleaning).not.toHaveBeenCalled();
});

it("marks an overdue departure for confirmation only today instead of extending it over future dates", async () => {
  const overdue = currentBooking({ check_in: "2026-10-19", check_out: "2026-10-20" });
  await render([overdue, futureBooking()]);

  expect(guestButtons("Niamke")).toHaveLength(1);
  expect(guestButtons("Niamke")[0].textContent).toContain("退房待确认");
  expect(guestButtons("Future guest").length).toBeGreaterThan(0);
  expect(host.querySelector('button[aria-label="1202 2026-10-22"]')).not.toBeNull();
  await act(async () => guestButtons("Niamke")[0].click());
  expect(panel().dataset.bookingStatus).toBe("checked_in");
  expect(panel().dataset.checkout).toBe("2026-10-20");
  expect(overdue.actual_check_out).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(completeCleaning).not.toHaveBeenCalled();
});

it.each([
  { checkIn: "2026-10-20", checkOut: "2026-10-21", label: "Départ prévu aujourd’hui" },
  { checkIn: "2026-10-19", checkOut: "2026-10-20", label: "Départ à confirmer" },
])("shows the French departure reminder $label without changing the stay", async (fixture) => {
  const booking = currentBooking({ check_in: fixture.checkIn, check_out: fixture.checkOut });
  await render([booking, futureBooking()], "fr");
  expect(guestButtons("Niamke")).toHaveLength(1);
  expect(guestButtons("Niamke")[0].textContent).toContain(fixture.label);
  expect(guestButtons("Future guest").length).toBeGreaterThan(0);
  await act(async () => guestButtons("Niamke")[0].click());
  expect(panel().dataset.bookingId).toBe(booking.id);
  expect(panel().dataset.bookingStatus).toBe("checked_in");
  expect(panel().dataset.checkout).toBe(fixture.checkOut);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(completeCleaning).not.toHaveBeenCalled();
});
