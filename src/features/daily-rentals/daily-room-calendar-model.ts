import type { DailyBookingRow, UnitRow } from "@/types/database";
import { dailyBookingOccupiesDate } from "./daily-workbench-model";

export interface DailyCalendarStay {
  booking: DailyBookingRow;
  first: number;
  last: number;
  lane: number;
}

interface CalendarSpan {
  first: number;
  last: number;
}

/** Reuse a stay lane's empty date cells before adding height for real overlap. */
export function dailyCalendarEventLanes<T extends CalendarSpan>(
  stays: readonly DailyCalendarStay[],
  stayLaneCount: number,
  events: readonly T[],
) {
  const baseLaneCount = Math.max(1, stayLaneCount);
  const occupied: CalendarSpan[][] = Array.from({ length: baseLaneCount }, () => []);
  for (const stay of stays) occupied[stay.lane].push({ first: stay.first, last: stay.last });
  const placedEvents = [...events]
    .sort((a, b) => a.first - b.first || a.last - b.last)
    .map((event) => {
      const available = occupied.findIndex((spans) =>
        spans.every((span) => span.last < event.first || span.first > event.last),
      );
      const lane = available < 0 ? occupied.length : available;
      if (!occupied[lane]) occupied.push([]);
      occupied[lane].push({ first: event.first, last: event.last });
      return { ...event, lane };
    });
  return { placedEvents, extraLaneCount: occupied.length - baseLaneCount };
}

/** Missing imported floor metadata stays unknown rather than being guessed from a room number. */
export function dailyCalendarFloorLabel(unit: Pick<UnitRow, "floor_label">) {
  return typeof unit.floor_label === "string" ? unit.floor_label.trim() : "";
}

/** Lane packing is presentation only; it never resolves conflicting business records. */
export function dailyCalendarStayLanes(
  bookings: readonly DailyBookingRow[],
  dates: readonly string[],
  today: string,
) {
  const stays = bookings
    .map((booking) => {
      const occupied = dates.map((date) => dailyBookingOccupiesDate(booking, date, today));
      return { booking, first: occupied.indexOf(true), last: occupied.lastIndexOf(true), lane: 0 };
    })
    .filter((stay) => stay.first >= 0)
    .sort(
      (a, b) => a.first - b.first || a.last - b.last || a.booking.id.localeCompare(b.booking.id),
    );
  const laneEnds: number[] = [];
  for (const stay of stays) {
    const freeLane = laneEnds.findIndex((end) => end < stay.first);
    stay.lane = freeLane < 0 ? laneEnds.length : freeLane;
    laneEnds[stay.lane] = stay.last;
  }
  return { stays, laneCount: Math.max(1, laneEnds.length) };
}

/** floor_label is the stored source of truth; never infer a floor from the room number. */
export function dailyCalendarFloors(units: readonly UnitRow[]) {
  return [...new Set(units.map(dailyCalendarFloorLabel))].sort((a, b) => {
    if (a === b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
  });
}

export function dailyCalendarUnits(units: readonly UnitRow[], buildingId: string) {
  return units
    .filter((unit) => unit.building_id === buildingId)
    .sort(
      (a, b) =>
        dailyCalendarFloorLabel(a).localeCompare(dailyCalendarFloorLabel(b), "en", {
          numeric: true,
        }) ||
        a.unit_no.localeCompare(b.unit_no, "en", { numeric: true }) ||
        a.id.localeCompare(b.id),
    );
}
