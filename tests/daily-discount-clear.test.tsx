// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BookingPanel } from "@/features/daily-rentals/booking-panel";
import { formatDailyRentalError } from "@/features/daily-rentals/booking-presentation";

import type { DailyBookingRow, UnitRow } from "@/types/database";

const { applyDiscount, refresh, onClose } = vi.hoisted(() => ({
  applyDiscount: vi.fn(),
  refresh: vi.fn(),
  onClose: vi.fn(),
}));
vi.mock("@/features/daily-rentals/actions", () => ({ applyDiscount }));
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
  manual_discount_amount_xof: 115,
  manual_discount_reason: null,
  final_amount_xof: 79885,
  status: "checked_in",
  ota_source: null,
  notes: null,
  created_at: "",
  updated_at: "",
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  applyDiscount.mockReset().mockResolvedValue({ success: true });
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

function button(label: string) {
  const found = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  expect(found).toBeDefined();
  return found!;
}
async function input(value: string) {
  const element = document.querySelector<HTMLInputElement>('input[placeholder="优惠金额"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function open(locale: "zh" | "fr" = "zh") {
  await renderDesktop({ locale });
  await act(async () => button(locale === "zh" ? "更多业务操作" : "Autres opérations").click());
  const entry = Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(locale === "zh" ? "优惠调整" : "Remise"),
  );
  expect(entry).toBeDefined();
  await act(async () => entry!.click());
}
it("submits an explicit zero to undo the discount, never treats an empty field as zero", async () => {
  await open();
  expect(button("应用优惠").disabled).toBe(true);
  await input("0");
  const undo = button("撤销优惠，恢复原价");
  expect(undo.disabled).toBe(false);
  await act(async () => undo.click());
  expect(applyDiscount).toHaveBeenCalledWith({
    bookingId: booking.id,
    amount: 0,
    reason: "撤销优惠，恢复原价",
  });
});
it.each(["-1", "0.5"])("rejects invalid input %s in the form", async (value) => {
  await open();
  await input(value);
  expect(button("应用优惠").disabled).toBe(true);
  expect(applyDiscount).not.toHaveBeenCalled();
});
