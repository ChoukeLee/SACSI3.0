import type { UnitRow, DailyBookingRow } from "@/types/database";
export type ViewMode = "day" | "week" | "month";
export type RoomFilter =
  | "all"
  | "available"
  | "occupied"
  | "checkingOutToday"
  | "openEnded"
  | "reserved"
  | "cleaning"
  | "maintenance";

export const ROOM_COL_WIDTH = 120;
export const ROW_HEIGHT = 36;
export const FLOOR_ROW_HEIGHT = 16;
export const MAINTENANCE_STATUSES = new Set([
  "available",
  "reserved",
  "daily_occupied",
  "cleaning_pending",
  "leased",
  "sold",
]);

export function getBookingTone(status: string): string {
  if (status === "checked_in") return "bg-[#62B6F5] text-white shadow-sm";
  if (status === "confirmed") return "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300";
  if (status === "pending_review")
    return "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200";
  return "bg-muted text-muted-foreground";
}

export function getRoomTone(unit: UnitRow, hasCleaning: boolean, isMaintenance: boolean) {
  if (isMaintenance) return { strip: "bg-[#F08090]" };
  if (hasCleaning || unit.status === "cleaning_pending") return { strip: "bg-[#5CC4B8]" };
  if (unit.status === "reserved") return { strip: "bg-[#E8C840]" };
  if (unit.status === "daily_occupied") return { strip: "bg-[#62B6F5]" };
  if (unit.status === "leased") return { strip: "bg-[#5E9BC5]" };
  if (unit.status === "sold") return { strip: "bg-[#B88A48]" };
  return { strip: "bg-[#A0D0E8]" };
}

export function getUnitTimelineStatus(
  unit: UnitRow,
  visibleDays: Date[],
  bookingMap: Map<string, Map<string, DailyBookingRow>>,
  unitCleaningMap: Map<string, string>,
  todayStr?: string,
): Exclude<RoomFilter, "all"> {
  if (!MAINTENANCE_STATUSES.has(unit.status)) return "maintenance";
  if (unitCleaningMap.has(unit.id) || unit.status === "cleaning_pending") return "cleaning";

  const unitBookings = bookingMap.get(unit.id);
  if (unitBookings) {
    for (const date of visibleDays) {
      const booking = unitBookings.get(toDateStr(date));
      if (!booking || booking.status === "checked_out") continue;
      if (booking.status === "checked_in") {
        if (booking.checkout_mode === "open") return "openEnded";
        if (todayStr && booking.check_out === todayStr) return "checkingOutToday";
        return "occupied";
      }
      if (booking.status === "confirmed" || booking.status === "pending_review") return "reserved";
    }
  }

  if (
    unit.status === "daily_occupied" &&
    todayStr &&
    visibleDays.some((date) => toDateStr(date) === todayStr)
  )
    return "occupied";
  return "available";
}

export function resolveRangeStart(anchorDate: Date, viewMode: ViewMode): Date {
  const anchor = startOfDay(anchorDate);
  if (viewMode === "month") return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  if (viewMode === "week") return startOfWeek(anchor);
  return anchor;
}

export function resolveRangeEnd(anchorDate: Date, viewMode: ViewMode): Date {
  const start = resolveRangeStart(anchorDate, viewMode);
  if (viewMode === "month") return new Date(start.getFullYear(), start.getMonth() + 1, 1);
  if (viewMode === "week") return addDays(start, 7);
  return addDays(start, 8);
}

export function formatRangeLabel(days: Date[], localeStr: string, viewMode: ViewMode): string {
  if (days.length === 0) return "";
  if (viewMode === "month") {
    return days[0].toLocaleDateString(localeStr, { year: "numeric", month: "long" });
  }
  const first = days[0];
  const last = days[days.length - 1];
  const firstText = first.toLocaleDateString(localeStr, { month: "short", day: "numeric" });
  const lastText = last.toLocaleDateString(localeStr, { month: "short", day: "numeric" });
  return `${first.getFullYear()} ${firstText} - ${lastText}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  const day = start.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(start, offset);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function toDateStr(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function serverMatchesPatch<T extends object>(serverRow: T, patch: Partial<T>): boolean {
  const serverRecord = serverRow as Record<string, unknown>;
  const patchRecord = patch as Record<string, unknown>;
  for (const key of Object.keys(patchRecord)) {
    if (!(key in serverRecord)) continue;
    if ((serverRecord[key] ?? null) !== (patchRecord[key] ?? null)) return false;
  }
  return true;
}
