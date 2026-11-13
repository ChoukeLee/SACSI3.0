// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BookingPanel } from "@/features/daily-rentals/booking-panel";
import { formatDailyRentalError } from "@/features/daily-rentals/booking-presentation";
import { MobileRoomDrawer } from "@/features/mobile/mobile-room-drawer";
import type { RoomState } from "@/features/mobile/room-state";
import type { DailyBookingRow, UnitRow } from "@/types/database";

const { cancelBooking, refresh, onClose } = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  refresh: vi.fn(),
  onClose: vi.fn(),
}));
vi.mock("@/features/daily-rentals/actions", () => ({ cancelBooking }));
vi.mock("@/features/daily-rentals/booking-notes-action", () => ({ saveBookingNotes: vi.fn() }));
vi.mock("@/features/units/actions", () => ({ updateUnitStatus: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const unit: UnitRow = {
  id: "room-901",
  building_id: "building-11",
  code: "SACSI11-901",
  unit_no: "901",
  floor_label: "9F",
  kind: "apartment",
  status: "reserved",
  area_sqm: null,
  layout: null,
  furnishing: null,
  notes: null,
  created_at: "",
  updated_at: "",
};
const booking: DailyBookingRow = {
  id: "booking-901",
  unit_id: unit.id,
  customer_id: "customer-1",
  check_in: "2026-11-11",
  check_out: "2026-11-13",
  checkout_mode: "fixed",
  actual_check_out: null,
  nightly_price_xof: 40000,
  total_amount_xof: 80000,
  prepaid_amount_xof: 0,
  billing_status: "need_top_up",
  manual_discount_amount_xof: 0,
  manual_discount_reason: null,
  final_amount_xof: 80000,
  status: "confirmed",
  ota_source: null,
  notes: null,
  created_at: "",
  updated_at: "",
};
const cleaning = {
  id: "previous-cleaning",
  unit_id: unit.id,
  daily_booking_id: "earlier-order",
  is_completed: false,
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cancelBooking.mockReset().mockResolvedValue({ success: true });
  refresh.mockClear();
  onClose.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function renderDesktop(props: Partial<ComponentProps<typeof BookingPanel>> = {}) {
  await act(async () =>
    root.render(
      <BookingPanel
        booking={booking}
        unitId={unit.id}
        units={[unit]}
        customers={[]}
        payments={[]}
        cleaningTasks={[]}
        locale="zh"
        onClose={onClose}
        onChanged={() => {}}
        {...props}
      />,
    ),
  );
}

const mobileRoom: RoomState = {
  unit,
  booking,
  customer: null,
  billing: null,
  totalPaid: 0,
  displayStatus: "cleaning",
  cleaningTask: cleaning,
};

async function renderMobile(props: Partial<ComponentProps<typeof MobileRoomDrawer>> = {}) {
  await act(async () =>
    root.render(
      <MobileRoomDrawer room={mobileRoom} open locale="zh" onClose={onClose} {...props} />,
    ),
  );
}

function buttons(label: string) {
  return Array.from(document.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === label && !button.closest("[hidden]"),
  );
}

async function click(label: string) {
  const matching = buttons(label);
  expect(matching).toHaveLength(1);
  await act(async () => matching[0].click());
}

function confirmation() {
  return document.querySelector(
    '[role="dialog"] [role="group"][aria-label="取消这笔预订？"], [role="dialog"][aria-labelledby="mobile-confirm-title"]',
  );
}

it("offers one desktop cancellation action for pending and confirmed reservations even with a room block", async () => {
  await renderDesktop({
    booking: { ...booking, status: "pending_review" },
    cleaningTasks: [cleaning],
  });
  expect(buttons("取消预订")).toHaveLength(1);
  expect(buttons("取消预订")[0].disabled).toBe(false);

  await renderDesktop({ units: [{ ...unit, operational_condition: "locked" }] });
  expect(buttons("取消预订")).toHaveLength(1);
  expect(buttons("取消预订")[0].disabled).toBe(false);
  expect(cancelBooking).not.toHaveBeenCalled();
});

it("hides desktop and mobile cancellation for read-only and checked-in orders", async () => {
  await renderDesktop({ readOnly: true });
  expect(buttons("取消预订")).toHaveLength(0);
  const occupiedBooking = { ...booking, status: "checked_in" } as const;
  await renderDesktop({ booking: occupiedBooking });
  expect(buttons("取消预订")).toHaveLength(0);

  await renderMobile({ readOnly: true });
  expect(buttons("取消预订")).toHaveLength(0);
  await renderMobile({
    room: { ...mobileRoom, booking: occupiedBooking, displayStatus: "occupied" },
  });
  expect(buttons("取消预订")).toHaveLength(0);
  expect(cancelBooking).not.toHaveBeenCalled();
});

it("blocks desktop cancellation when either net payments or the recorded prepayment is nonzero", async () => {
  const blockedReason = formatDailyRentalError("bookingHasPayments", "zh");
  expect(blockedReason).toMatch(/收款/);
  await renderDesktop({
    payments: [
      { id: "payment-1", source_id: booking.id, amount: 40000, payment_date: "2026-11-11" },
    ],
  });
  expect(buttons("取消预订")[0].disabled).toBe(true);
  expect(document.body.textContent).toContain(blockedReason);

  await renderDesktop({ booking: { ...booking, prepaid_amount_xof: 40000 } });
  expect(buttons("取消预订")[0].disabled).toBe(true);
  expect(document.body.textContent).toContain(blockedReason);
  expect(cancelBooking).not.toHaveBeenCalled();
});

it("explains the mobile payment block in French", async () => {
  const blockedReason = formatDailyRentalError("bookingHasPayments", "fr");
  expect(blockedReason).toMatch(/paiement|encaissement/i);
  await renderMobile({
    locale: "fr",
    room: { ...mobileRoom, booking: { ...booking, prepaid_amount_xof: 40000 } },
  });
  expect(buttons("Annuler la réservation")).toHaveLength(0);
  expect(document.body.textContent).toContain(blockedReason);
  expect(cancelBooking).not.toHaveBeenCalled();
});

it.each(["desktop", "mobile"] as const)(
  "requires explicit confirmation and never carries it to another booking on %s",
  async (surface) => {
    const renderBooking = (value: DailyBookingRow) =>
      surface === "desktop"
        ? renderDesktop({ booking: value })
        : renderMobile({ room: { ...mobileRoom, booking: value } });
    await renderBooking(booking);
    await click("取消预订");
    expect(confirmation()).not.toBeNull();
    expect(cancelBooking).not.toHaveBeenCalled();
    if (surface === "desktop") {
      expect(confirmation()?.contains(buttons("确认取消预订")[0])).toBe(true);
      expect(document.activeElement).toBe(buttons("保留预订")[0]);
      await click("保留预订");
      expect(confirmation()).toBeNull();
      expect(document.activeElement).toBe(buttons("取消预订")[0]);
      await click("取消预订");
    }

    const nextBooking = { ...booking, id: "another-booking" };
    await renderBooking(nextBooking);
    expect(confirmation()).toBeNull();
    expect(cancelBooking).not.toHaveBeenCalled();

    await click("取消预订");
    await click("确认取消预订");
    expect(cancelBooking).toHaveBeenCalledExactlyOnceWith(nextBooking.id);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);

it("keeps the mobile confirmation open and shows the service failure", async () => {
  cancelBooking.mockResolvedValueOnce({ success: false, error: "dailyCancelPermissionDenied" });
  const permissionMessage = formatDailyRentalError("dailyCancelPermissionDenied", "zh");
  expect(permissionMessage).toMatch(/权限|账号/);
  await renderMobile();
  await click("取消预订");
  await click("确认取消预订");

  expect(cancelBooking).toHaveBeenCalledExactlyOnceWith(booking.id);
  expect(confirmation()?.querySelector('[role="alert"]')?.textContent).toBe(permissionMessage);
  expect(onClose).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
