// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import {
  DailyWorkbenchTimeline,
  type DailyWorkbenchTimelineProps,
} from "@/features/daily-rentals/daily-workbench-timeline";
import styles from "@/features/daily-rentals/daily-room-calendar.module.css";
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
    expect(stay.style.gridRow).toBe(handover.style.gridRow);
    expect(host.querySelector(`.${styles.track}`)!.getAttribute("style")).not.toContain(
      "--event-row-height",
    );
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
    const maintenanceButton = buttonWithText("维修");
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

  it.each([7, 14, 3])(
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
        dayCount === 7 ? "2026-10-13" : dayCount === 14 ? "2026-10-06" : "2026-10-17",
      );
      expect(props.onRangeChange).toHaveBeenNthCalledWith(
        2,
        dayCount === 7 ? "2026-10-27" : dayCount === 14 ? "2026-11-03" : "2026-10-23",
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

  it("uses the real floor labels, retains every room, and filters one floor without guessing from room numbers", async () => {
    const rooms = [
      { ...room, id: "r10", unit_no: "101", floor_label: "10F" },
      { ...room, id: "r2", unit_no: "999", floor_label: "2F" },
      { ...room, id: "unknown", unit_no: "301", floor_label: "" },
    ];
    await render({ data: snapshot([], rooms) });
    expect(host.querySelectorAll("tr[data-unit-id]")).toHaveLength(3);
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((option) => option.text)).toEqual([
      "全部楼层",
      "2F",
      "10F",
      "楼层未登记",
    ]);
    await act(async () => {
      select.value = "2F";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelectorAll("tr[data-unit-id]")).toHaveLength(1);
    expect(host.querySelector('tr[data-unit-id="r2"]')).not.toBeNull();
    expect(host.textContent).not.toContain("301");
    await act(async () => {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector('tr[data-unit-id="unknown"]')).not.toBeNull();
    expect(host.querySelectorAll("tr[data-unit-id]")).toHaveLength(1);
  });

  it("resets a former building's floor choice when the visible building changes", async () => {
    await render();
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      select.value = "1F";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const nextRoom = {
      ...room,
      id: "other-room",
      building_id: calendarOtherBuilding,
      floor_label: "2F",
    };
    await render({ data: { ...snapshot([], [nextRoom]), buildingId: calendarOtherBuilding } });
    expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe("all");
    expect(host.querySelector('tr[data-unit-id="other-room"]')).not.toBeNull();
  });

  it("notifies its parent to discard inspector and action context when changing floors", async () => {
    const onScopeChange = vi.fn();
    await render({
      data: snapshot([], [room, { ...room, id: "other-floor", unit_no: "201", floor_label: "2F" }]),
      onScopeChange,
    });
    expect(onScopeChange).not.toHaveBeenCalled();
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      select.value = "2F";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onScopeChange).toHaveBeenCalledTimes(1);
    expect(host.querySelector('tr[data-unit-id="other-floor"]')).not.toBeNull();
    expect(host.querySelector(`tr[data-unit-id="${room.id}"]`)).toBeNull();
    expect(props.onChoose).not.toHaveBeenCalled();
    expect(props.onRangeChange).not.toHaveBeenCalled();
  });

  it("chooses the exact empty date without writing or labeling a held date as free", async () => {
    await render({ selectedUnitId: room.id, selectedDate: "2026-10-24" });
    const empty = host.querySelector<HTMLButtonElement>(
      'button[aria-label*="2026-10-24 查看日期与预订"]',
    )!;
    expect(empty.getAttribute("aria-pressed")).toBe("true");
    expect(empty.getAttribute("aria-controls")).toBe("daily-inspector");
    await click(empty);
    expect(props.onChoose).toHaveBeenCalledWith(room.id, null, "2026-10-24");
    expect(host.querySelector('button[aria-label*="2026-10-20 查看日期与预订"]')).toBeNull();
  });

  it("shows conflicting records in distinct lanes and never hides a guest behind another stay", async () => {
    await render({
      data: snapshot([
        booking(),
        booking({
          id: "overlap",
          guest_name: "Sample guest conflict",
          check_in: "2026-10-21",
          check_out: "2026-10-24",
          status: "confirmed",
        }),
      ]),
    });
    const first = bandFor("Sample guest A")!;
    const second = bandFor("Sample guest conflict")!;
    expect(first.style.gridRow).toBe("1");
    expect(second.style.gridRow).toBe("2");
    expect(host.querySelector(`.${styles.track}`)!.getAttribute("style")).toContain(
      "repeat(2, var(--room-row-height))",
    );
    const handover = buttonWithText("预计交接");
    expect(handover.style.gridRow).toBe(first.style.gridRow);
    expect(columns(handover)[0]).toBe(columns(first)[1]);
    await click(second);
    expect(props.onChoose).toHaveBeenCalledWith(room.id, "overlap");
  });

  it("places current maintenance and cleaning in separate event lanes without covering an active stay", async () => {
    await render({
      data: {
        ...snapshot([booking()], [{ ...room, operational_condition: "maintenance" }]),
        cleaningTasks: [
          { id: "clean", unit_id: room.id, daily_booking_id: "booking-a", is_completed: false },
        ],
      },
    });
    const stay = bandFor("Sample guest A")!;
    const maintenance = buttonWithText("维修");
    const cleaning = buttonWithText("待保洁");
    expect(Number(maintenance.style.gridRow)).toBeGreaterThan(Number(stay.style.gridRow));
    expect(Number(cleaning.style.gridRow)).toBeGreaterThan(Number(stay.style.gridRow));
    expect(maintenance.style.gridRow).not.toBe(cleaning.style.gridRow);
    expect(maintenance.getAttribute("aria-label")).toContain("当前限制状态，历史范围未核实");
    expect(stay.textContent).toContain("在住");
  });

  it.each(["maintenance", "cleaning"])(
    "keeps an empty room's %s marker in the compact existing room lane",
    async (kind) => {
      await render({
        data: {
          ...snapshot(
            [],
            [{ ...room, operational_condition: kind === "maintenance" ? "maintenance" : "normal" }],
          ),
          cleaningTasks:
            kind === "cleaning"
              ? [{ id: "clean", unit_id: room.id, daily_booking_id: null, is_completed: false }]
              : [],
        },
      });
      const event = buttonWithText(kind === "maintenance" ? "维修" : "待保洁");
      expect(event.style.gridRow).toBe("1");
      expect(host.querySelector(`.${styles.track}`)!.getAttribute("style")).toContain(
        "repeat(1, var(--room-row-height))",
      );
      expect(host.querySelector(`.${styles.track}`)!.getAttribute("style")).not.toContain(
        "--event-row-height",
      );
    },
  );

  it("keeps genuinely simultaneous handover and next arrival visible in separate lanes", async () => {
    await render({
      data: snapshot([
        booking(),
        booking({
          id: "next",
          guest_name: "Next arrival",
          check_in: "2026-10-23",
          check_out: "2026-10-25",
          status: "confirmed",
        }),
      ]),
    });
    const next = bandFor("Next arrival")!;
    const handover = buttonWithText("预计交接");
    expect(columns(handover)).toEqual([4, 5]);
    expect(handover.style.gridRow).not.toBe(next.style.gridRow);
    expect(host.querySelector(`.${styles.track}`)!.getAttribute("style")).toContain(
      "repeat(1, var(--event-row-height))",
    );
  });

  it("does not crash or infer a floor when an imported room omits floor metadata", async () => {
    const rooms = [
      { ...room, id: "missing", unit_no: "101", floor_label: null },
      { ...room, id: "absent", unit_no: "202", floor_label: undefined },
    ] as unknown as UnitRow[];
    await render({ data: snapshot([], rooms) });
    expect(host.querySelectorAll("tr[data-unit-id]")).toHaveLength(2);
    expect(host.textContent).toContain("楼层未登记");
    expect([...host.querySelectorAll("select option")].map((option) => option.textContent)).toEqual(
      ["全部楼层", "楼层未登记"],
    );
  });

  it("uses a distinct completed style and literal status instead of grouping history with active restrictions", async () => {
    await render({
      data: snapshot([booking({ status: "checked_out", actual_check_out: "2026-10-22" })]),
    });
    const completed = bandFor("Sample guest A")!;
    expect(completed.classList.contains(styles.completedBand)).toBe(true);
    expect(completed.classList.contains(styles.inhouseBand)).toBe(false);
    expect(completed.classList.contains(styles.conditionalBand)).toBe(false);
    expect(completed.textContent).toContain("已退房");
  });

  it("highlights task rooms without removing any other room or auto-selecting an order", async () => {
    const rooms = Array.from({ length: 42 }, (_, index) => ({
      ...room,
      id: `r-${index}`,
      unit_no: String(index + 101),
    }));
    await render({ data: snapshot([], rooms), highlightedUnitIds: ["r-1"], selectedUnitId: "r-2" });
    expect(host.querySelectorAll("tr[data-unit-id]")).toHaveLength(42);
    expect(
      host.querySelector('tr[data-unit-id="r-1"]')!.classList.contains(styles.highlightedRoom),
    ).toBe(true);
    expect(
      host.querySelector('tr[data-unit-id="r-2"]')!.classList.contains(styles.selectedRoom),
    ).toBe(true);
    expect(props.onChoose).not.toHaveBeenCalled();
  });

  it("has room/date table headings and localized keyboard-accessible empty dates", async () => {
    await render({ locale: "fr", data: snapshot([]) });
    expect(host.querySelectorAll('thead th[scope="col"]')).toHaveLength(8);
    expect(host.querySelector('tbody th[scope="row"]')).not.toBeNull();
    expect(host.querySelector('th[aria-current="date"]')).not.toBeNull();
    const empty = host.querySelector<HTMLButtonElement>(
      'button[aria-label*="2026-10-20 Vérifier la date et la réservation"]',
    )!;
    expect(empty).not.toBeNull();
    await click(empty);
    expect(props.onChoose).toHaveBeenCalledWith(room.id, null, today);
    expect(host.querySelector('div[role="region"][tabindex="0"]')).not.toBeNull();
  });
});
