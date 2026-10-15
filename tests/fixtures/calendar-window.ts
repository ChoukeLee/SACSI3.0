import type { CalendarWindowData } from "@/features/daily-rentals/calendar-window-model";
export const calendarBuilding = "11111111-1111-4111-8111-111111111111";
export const calendarOtherBuilding = "22222222-2222-4222-8222-222222222222";
export function calendarWindowFixture(
  overrides: Partial<CalendarWindowData> = {},
): CalendarWindowData {
  return {
    buildingId: calendarBuilding,
    from: "2026-10-15",
    to: "2026-10-23",
    today: "2026-10-15",
    bookings: [],
    bookingCount: 0,
    payments: [],
    paymentCount: 0,
    cleaningTasks: [],
    dailyUnits: [],
    unitLookupUnits: [],
    buildingCounts: { [calendarBuilding]: 0, [calendarOtherBuilding]: 0 },
    currentOutstanding: 100,
    monthSettled: 0,
    financeSnapshot: {
      today: "2026-10-15",
      month: "2026-10",
      cash: null,
      includedPaymentIds: [],
      currentOutstanding: 100,
      monthSettled: 0,
    },
    ...overrides,
  };
}
