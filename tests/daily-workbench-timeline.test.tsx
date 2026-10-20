// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import {
  DailyWorkbenchTimeline,
  type DailyWorkbenchTimelineProps,
} from "@/features/daily-rentals/daily-workbench-timeline";
import styles from "@/features/daily-rentals/daily-workbench.module.css";
import {
  calendarBuilding,
  calendarOtherBuilding,
  calendarWindowFixture,
} from "./fixtures/calendar-window";

const today = "2026-10-20";
const room = {
  id: "room-101",
  building_id: calendarBuilding,
  code: "SACSI11-101",
  unit_no: "101",
  floor_label: "1F",
  kind: "apartment",
  status: "available",
  daily_rental_enabled: true,
  operational_condition: "normal",
  area_sqm: null,
  layout: null,
  furnishing: null,
  notes: null,
  created_at: "",
  updated_at: "",
} satisfies UnitRow;

function booking(overrides: Partial<DailyBookingRow> = {}): DailyBookingRow {
  return {
    id: "booking-a",
    unit_id: room.id,
    customer_id: "agent-a",
    guest_name: "Sample guest A",
    check_in: today,
    check_out: "2026-10-23",
    actual_check_out: null,
    checkout_mode: "fixed",
    nightly_price_xof: 40_000,
    total_amount_xof: 120_000,
    prepaid_amount_xof: 0,
    billing_status: "prepaid",
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

function snapshot(bookings: DailyBookingRow[] = [], units: UnitRow[] = [room]) {
  return calendarWindowFixture({
    today,
    from: today,
    to: "2026-10-27",
    bookings,
    bookingCount: bookings.length,
    dailyUnits: units,
    unitLookupUnits: units,
  });
}

let host: HTMLDivElement;
let root: Root;
let props: DailyWorkbenchTimelineProps;
async function render(overrides: Partial<DailyWorkbenchTimelineProps> = {}) {
  props = { ...props, ...overrides };
  await act(async () => root.render(<DailyWorkbenchTimeline {...props} />));
}
function buttonWithText(text: string) {
  const found = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  );
  expect(found, text).toBeDefined();
  return found!;
}
function bandFor(guestName: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button[aria-label]")].find((button) =>
    button.getAttribute("aria-label")?.includes(guestName),
  );
}
function columns(button: HTMLButtonElement) {
  return button.style.gridColumn.split("/").map((value) => Number(value.trim()));
}
async function click(button: HTMLButtonElement) {
  await act(async () => button.click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    data: snapshot([booking()]),
    from: today,
    dayCount: 7,
    today,
    buildingLabel: "11 号楼",
    locale: "zh",
    inspectorId: "daily-inspector",
    onChoose: vi.fn(),
    onRangeChange: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("daily workbench timeline", () => {
  it("keeps a future fixed checkout outside the green lodging band and marks handover separately", async () => {
    await render({ selectedBookingId: "booking-a" });
    const stay = bandFor("Sample guest A")!;
    const handover = buttonWithText("预计交接");
    expect(stay.classList.contains(styles.inhouseBand)).toBe(true);
    expect(stay.classList.contains(styles.conditionalBand)).toBe(false);
    expect(columns(stay)).toEqual([1, 4]);
    expect(columns(handover)).toEqual([4, 5]);
    expect(handover.classList.contains(styles.inhouseBand)).toBe(false);
    expect(handover.classList.contains(styles.conditionalBand)).toBe(true);
    expect(stay.getAttribute("aria-controls")).toBe("daily-inspector");
    expect(stay.getAttribute("aria-pressed")).toBe("true");
    await click(stay);
    await click(handover);
    expect(props.onChoose).toHaveBeenNthCalledWith(1, room.id, "booking-a");
    expect(props.onChoose).toHaveBeenNthCalledWith(2, room.id, "booking-a");
  });

  it.each([today, "2026-10-19"])(
    "continues an unclosed stay due on %s and explicitly marks departure unverified",
    async (checkOut) => {
      await render({ data: snapshot([booking({ check_in: "2026-10-18", check_out: checkOut })]) });
      const stay = bandFor("Sample guest A")!;
      expect(columns(stay)).toEqual([1, 8]);
      expect(stay.textContent).toContain("退房待核实");
      expect(stay.classList.contains(styles.conditionalBand)).toBe(true);
      expect(
        [...host.querySelectorAll("button")].some((button) =>
          button.textContent?.includes("预计交接"),
        ),
      ).toBe(false);
    },
  );

  it("does not invent an end date for an open checkout stay", async () => {
    await render({
      data: snapshot([booking({ check_in: "2026-10-18", checkout_mode: "open", check_out: null })]),
    });
    const stay = bandFor("Sample guest A")!;
    expect(columns(stay)).toEqual([1, 8]);
    expect(stay.textContent).toContain("离店未定");
    expect(stay.getAttribute("aria-label")).toContain("离店未定");
    expect(
      [...host.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("预计交接"),
      ),
    ).toBe(false);
    await render({ from: "2026-10-27", dayCount: 3 });
    expect(columns(bandFor("Sample guest A")!)).toEqual([1, 4]);
    expect(bandFor("Sample guest A")!.textContent).toContain("离店未定");
  });

  it("does not overlap lodging bands when one guest's future checkout is the next guest's check-in", async () => {
    await render({
      data: snapshot([
        booking(),
        booking({
          id: "booking-b",
          guest_name: "Sample guest B",
          status: "confirmed",
          check_in: "2026-10-23",
          check_out: "2026-10-25",
        }),
      ]),
    });
    const firstStay = bandFor("Sample guest A")!;
    const nextStay = bandFor("Sample guest B")!;
    expect(columns(firstStay)).toEqual([1, 4]);
    expect(columns(nextStay)).toEqual([4, 6]);
    expect(columns(firstStay)[1]).toBe(columns(nextStay)[0]);
    expect(firstStay.classList.contains(styles.inhouseBand)).toBe(true);
    expect(nextStay.classList.contains(styles.inhouseBand)).toBe(false);
    expect(columns(buttonWithText("预计交接"))).toEqual([4, 5]);
  });

  it("uses only actual departure to draw completed history, not the later planned departure", async () => {
    await render({
      data: snapshot([
        booking({
          status: "checked_out",
          check_in: "2026-10-18",
          actual_check_out: "2026-10-21",
          check_out: "2026-10-25",
        }),
      ]),
    });
    const stay = bandFor("Sample guest A")!;
    expect(columns(stay)).toEqual([1, 2]);
    expect(stay.classList.contains(styles.inhouseBand)).toBe(false);
    expect(stay.getAttribute("aria-label")).toContain("10/21");
    expect(stay.getAttribute("aria-label")).not.toContain("10/25");
    await click(stay);
    expect(props.onChoose).toHaveBeenCalledWith(room.id, "booking-a");
  });

  it("does not guess historical occupancy when actual departure is missing", async () => {
    await render({
      data: snapshot([
        booking({ status: "checked_out", actual_check_out: null, check_out: "2026-10-25" }),
      ]),
    });
    expect(bandFor("Sample guest A")).toBeUndefined();
    expect(
      [...host.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("预计交接"),
      ),
    ).toBe(false);
  });

  it("marks maintenance and pending cleaning separately and lets users select their room details", async () => {
    const maintenance = { ...room, operational_condition: "maintenance" as const };
    const cleaning = {
      ...room,
      id: "room-102",
      unit_no: "102",
      code: "SACSI11-102",
      status: "cleaning_pending" as const,
    };
    await render({
      data: {
        ...snapshot([], [maintenance, cleaning]),
        cleaningTasks: [
          { id: "clean-a", unit_id: cleaning.id, daily_booking_id: null, is_completed: false },
        ],
      },
    });
    const maintenanceButton = buttonWithText("维修 / 锁房");
    const cleaningButton = buttonWithText("待保洁");
    expect(columns(maintenanceButton)).toEqual([1, 8]);
    expect(columns(cleaningButton)).toEqual([1, 2]);
    await click(maintenanceButton);
    await click(cleaningButton);
    expect(props.onChoose).toHaveBeenNthCalledWith(1, maintenance.id, null);
    expect(props.onChoose).toHaveBeenNthCalledWith(2, cleaning.id, null);
    await render({ from: "2026-10-27" });
    expect(
      [...host.querySelectorAll("button")].some((button) => button.textContent === "待保洁"),
    ).toBe(false);
  });

  it.each([7, 3])(
    "renders %s date columns and moves its range by the same number of days",
    async (dayCount) => {
      await render({ dayCount });
      const header = host.querySelector(`.${styles.timeHead}`)!;
      expect(header.children).toHaveLength(dayCount + 1);
      expect(host.querySelector("section")!.style.getPropertyValue("--day-count")).toBe(
        String(dayCount),
      );
      await click(host.querySelector<HTMLButtonElement>('button[aria-label="前一段日期"]')!);
      await click(host.querySelector<HTMLButtonElement>('button[aria-label="后一段日期"]')!);
      await click(buttonWithText("今天"));
      expect(props.onRangeChange).toHaveBeenNthCalledWith(
        1,
        dayCount === 7 ? "2026-10-13" : "2026-10-17",
      );
      expect(props.onRangeChange).toHaveBeenNthCalledWith(
        2,
        dayCount === 7 ? "2026-10-27" : "2026-10-23",
      );
      expect(props.onRangeChange).toHaveBeenNthCalledWith(3, today);
    },
  );

  it("does not display cancelled stays or another building's room", async () => {
    await render({
      data: snapshot(
        [booking({ status: "cancelled" })],
        [room, { ...room, id: "foreign-room", unit_no: "999", building_id: calendarOtherBuilding }],
      ),
    });
    expect(bandFor("Sample guest A")).toBeUndefined();
    expect(host.textContent).not.toContain("999");
  });

  it("keeps French planning and open-departure labels localized", async () => {
    await render({
      locale: "fr",
      data: snapshot([booking({ checkout_mode: "open", check_out: null })]),
    });
    expect(host.querySelector('section[aria-label="Planning des chambres"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Période précédente"]')).not.toBeNull();
    expect(bandFor("Sample guest A")!.textContent).toContain("Départ ouvert");
    expect(host.textContent).not.toContain("离店未定");
  });
});
