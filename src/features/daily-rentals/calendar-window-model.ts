import type { DailyBookingRow, UnitRow } from "@/types/database";
import type { CalendarFinanceSnapshot } from "./calendar-finance-model";

export interface CalendarWindowQuery {
  buildingId: string;
  from: string;
  to: string;
}
export interface CalendarWindowData extends CalendarWindowQuery {
  today: string;
  bookings: DailyBookingRow[];
  bookingCount: number;
  payments: {
    id: string;
    source_id: string;
    unit_id?: string | null;
    amount: number;
    payment_date: string;
    reversal_of_payment_id: string | null;
    request_kind: string | null;
  }[];
  paymentCount: number;
  cleaningTasks: {
    id: string;
    unit_id: string;
    daily_booking_id: string | null;
    is_completed: boolean;
  }[];
  dailyUnits: UnitRow[];
  unitLookupUnits: UnitRow[];
  buildingCounts: Record<string, number>;
  currentOutstanding: number;
  monthSettled: number;
  financeSnapshot?: CalendarFinanceSnapshot;
}
export class CalendarWindowError extends Error {
  constructor(
    message = "calendarWindowUnavailable",
    public status = 503,
  ) {
    super(message);
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export function parseCalendarWindow(value: Record<string, unknown>): CalendarWindowQuery {
  if (
    Object.keys(value).some((key) => !["buildingId", "from", "to"].includes(key)) ||
    typeof value.buildingId !== "string" ||
    !uuid.test(value.buildingId) ||
    !date(value.from) ||
    !date(value.to)
  )
    throw new CalendarWindowError("invalidCalendarWindow", 400);
  const days = (Date.parse(value.to) - Date.parse(value.from)) / 86400000;
  if (days < 1 || days > 62) throw new CalendarWindowError("invalidCalendarWindow", 400);
  return { buildingId: value.buildingId, from: value.from, to: value.to };
}
export function sameCalendarWindow(a: CalendarWindowQuery, b: CalendarWindowQuery) {
  return a.buildingId === b.buildingId && a.from === b.from && a.to === b.to;
}
export function decodeCalendarWindow(
  value: unknown,
  expected: CalendarWindowQuery,
): CalendarWindowData {
  if (!value || typeof value !== "object") throw new CalendarWindowError();
  const row = value as CalendarWindowData;
  if (
    !sameCalendarWindow(row, expected) ||
    !date(row.today) ||
    !Array.isArray(row.bookings) ||
    !Number.isSafeInteger(row.bookingCount) ||
    row.bookingCount !== row.bookings.length ||
    !Array.isArray(row.payments) ||
    !Number.isSafeInteger(row.paymentCount) ||
    row.paymentCount !== row.payments.length ||
    !Array.isArray(row.dailyUnits) ||
    !Array.isArray(row.unitLookupUnits) ||
    !Array.isArray(row.cleaningTasks) ||
    !row.buildingCounts ||
    !Number.isFinite(row.currentOutstanding) ||
    !Number.isFinite(row.monthSettled) ||
    row.bookings.some(
      (b) => !b || typeof b.id !== "string" || typeof b.unit_id !== "string" || !date(b.check_in),
    ) ||
    row.payments.some((p) => !p || typeof p.id !== "string" || !date(p.payment_date)) ||
    row.unitLookupUnits.some((u) => !u || u.building_id !== expected.buildingId) ||
    row.dailyUnits.some((u) => !u || u.building_id !== expected.buildingId)
  )
    throw new CalendarWindowError();
  const unitIds = new Set(row.unitLookupUnits.map((unit) => unit.id));
  if (
    unitIds.size !== row.unitLookupUnits.length ||
    new Set(row.bookings.map((booking) => booking.id)).size !== row.bookings.length ||
    new Set(row.payments.map((payment) => payment.id)).size !== row.payments.length ||
    row.bookings.some((booking) => !unitIds.has(booking.unit_id)) ||
    row.dailyUnits.some((unit) => !unitIds.has(unit.id)) ||
    row.cleaningTasks.some(
      (task) => !task || !unitIds.has(task.unit_id) || task.is_completed !== false,
    ) ||
    Object.values(row.buildingCounts).some((count) => !Number.isSafeInteger(count) || count < 0)
  )
    throw new CalendarWindowError();
  return row;
}
