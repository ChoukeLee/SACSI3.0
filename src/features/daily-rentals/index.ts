export { DailyCalendar } from "./calendar";
export type { CustomerSummary } from "./calendar";
export { BookingPanel } from "./booking-panel";

export { calculateBilling, billingModeLabel } from "./billing";
export type { BillingResult } from "./billing";
export {
  createBooking, confirmBooking, checkIn, checkOut,
  completeCleaning, extendStay, cancelBooking,
  recordSupplementaryPayment, applyDiscount, deletePayment,
  checkConflicts,
} from "./actions";
export {
  getDailyRoomStateForDate,
  buildDailyRoomStateMap,
  getBookingColorClass,
  buildBookingMap,
} from "./room-status";
export type { DailyRoomDisplayStatus, DailyRoomStateForDate } from "./room-status";
export { STATUS_COLORS } from "./room-status";
