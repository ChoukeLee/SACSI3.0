import { expect, it } from "vitest";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import { dailyWorkbenchShareText } from "@/features/daily-rentals/daily-workbench-share";
import {
  calendarBuilding,
  calendarOtherBuilding,
  calendarWindowFixture,
} from "./fixtures/calendar-window";

function unit(no: string, overrides: Partial<UnitRow> = {}): UnitRow {
  return {
    id: `unit-${no}`,
    building_id: calendarBuilding,
    code: `SACSI11-${no}`,
    unit_no: no,
    floor_label: "1F",
    kind: "apartment",
    status: "available",
    operational_condition: "normal",
    daily_rental_enabled: true,
    area_sqm: null,
    layout: "单间",
    furnishing: null,
    notes: "PRIVATE_UNIT_NOTE",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function booking(overrides: Partial<DailyBookingRow> = {}): DailyBookingRow {
  return {
    id: "PRIVATE_BOOKING_ID",
    unit_id: "unit-101",
    customer_id: "PRIVATE_CONTACT_ID",
    booking_agent_id: "PRIVATE_AGENT_ID",
    guest_customer_id: "PRIVATE_GUEST_ID",
    guest_name: "PRIVATE_GUEST_NAME",
    check_in: "2026-10-20",
    check_out: "2026-10-23",
    checkout_mode: "fixed",
    actual_check_out: null,
    nightly_price_xof: 987654321,
    total_amount_xof: 876543210,
    prepaid_amount_xof: 765432109,
    billing_status: "partially_paid",
    manual_discount_amount_xof: 654321098,
    manual_discount_reason: "PRIVATE_DISCOUNT_NOTE",
    final_amount_xof: null,
    status: "confirmed",
    ota_source: "PRIVATE_OTA",
    notes: "PRIVATE_BOOKING_NOTE",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function fixture() {
  const units = [unit("101"), unit("102", { status: "daily_occupied" }), unit("103")];
  const bookings = [
    booking(),
    booking({
      id: "PRIVATE_SECOND_ID",
      unit_id: "unit-102",
      guest_name: "PRIVATE_SECOND_GUEST",
      check_in: "2026-10-18",
      check_out: "2026-10-20",
      status: "checked_in",
    }),
  ];
  return calendarWindowFixture({
    today: "2026-10-20",
    from: "2026-10-20",
    to: "2026-10-27",
    dailyUnits: units,
    unitLookupUnits: units,
    bookings,
    bookingCount: bookings.length,
    customers: [
      {
        id: "PRIVATE_AGENT_ID",
        name: "PRIVATE_AGENT_NAME",
        phone: "+2250700123456",
        is_blacklisted: false,
      },
    ],
    customerCount: 1,
    payments: [
      {
        id: "PRIVATE_PAYMENT_ID",
        source_id: "PRIVATE_BOOKING_ID",
        amount: 543210987,
        payment_date: "2026-10-20",
        reversal_of_payment_id: null,
        request_kind: "PRIVATE_PAYMENT_KIND",
      },
    ],
    paymentCount: 1,
    currentOutstanding: 432109876,
    monthSettled: 321098765,
    cleaningTasks: [
      {
        id: "PRIVATE_CLEANING_ID",
        unit_id: "unit-103",
        daily_booking_id: null,
        is_completed: false,
      },
    ],
  });
}

it("copies only scoped operational counts and room readiness, excluding guest identity, phone and every financial field", () => {
  const text = dailyWorkbenchShareText(fixture(), "11 号楼", "zh");
  expect(text).toContain("11 号楼 · 日租房态 · 2026-10-20");
  expect(text).toContain("待入住/待核实 1 · 在住 1 · 应退/待核实 1 · 待保洁 1");
  expect(text).toContain("101");
  expect(text).toContain("102");
  expect(text).toContain("103");
  expect(text).toContain("分类数量不可相加");
  expect(text).not.toContain("PRIVATE_");
  expect(text).not.toContain("+225");
  expect(text).not.toContain("0700123456");
  for (const amount of [
    987654321, 876543210, 765432109, 654321098, 543210987, 432109876, 321098765,
  ]) {
    expect(text).not.toContain(String(amount));
    expect(text).not.toContain(new Intl.NumberFormat("en-US").format(amount));
  }
  expect(text).not.toContain("XOF");
});

it("does not copy foreign-building rooms and does not mutate the source snapshot", () => {
  const data = fixture();
  const foreign = unit("999", { building_id: calendarOtherBuilding, code: "SACSI5-999" });
  data.dailyUnits.push(foreign);
  data.unitLookupUnits.push(foreign);
  data.bookings.push(booking({ id: "PRIVATE_FOREIGN_ID", unit_id: foreign.id }));
  data.bookingCount += 1;
  const before = structuredClone(data);
  const text = dailyWorkbenchShareText(data, "11 号楼", "zh");
  expect(text).not.toContain("999");
  expect(text).toContain("待入住/待核实 1");
  expect(data).toEqual(before);
});

it("keeps incomplete room evidence unknown rather than claiming a room is ready", () => {
  const data = fixture();
  data.bookingCount += 1;
  const text = dailyWorkbenchShareText(data, "11 号楼", "zh");
  expect(text).toContain("读取范围不完整，房态未知");
  expect(text).not.toContain("当前房间已就绪");
});

it("provides the same privacy boundary and scope caveat in French", () => {
  const text = dailyWorkbenchShareText(fixture(), "Bâtiment 11", "fr");
  expect(text).toContain("Bâtiment 11 · Occupation journalière · 2026-10-20");
  expect(text).toContain("Arrivées 1 · En séjour 1 · Départs 1 · Ménage 1");
  expect(text).toContain("Selon les chambres accessibles au compte");
  expect(text).not.toContain("PRIVATE_");
  expect(text).not.toContain("XOF");
  expect(text).not.toContain("0700123456");
});
