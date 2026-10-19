import type { DailyBookingRow } from "@/types/database";

type BookingIdentity = Pick<
  DailyBookingRow,
  "id" | "customer_id" | "guest_customer_id" | "booking_agent_id"
>;

/** Matches the directory's daily_unknown role; legacy customer_id alone proves neither role. */
export function unresolvedCustomerBookings<T extends BookingIdentity>(
  customerId: string,
  bookings: T[],
): T[] {
  return bookings.filter(
    (booking) =>
      booking.customer_id === customerId &&
      booking.guest_customer_id !== customerId &&
      booking.booking_agent_id !== customerId,
  );
}

/** A contact or a legacy financial customer_id is not evidence of the actual guest. */
export function customerProfileFinancialRows<
  T extends { source_type: string; source_id: string | null },
>(customerId: string, rows: T[], guestBookings: BookingIdentity[]): T[] {
  const explicitGuestIds = new Set(
    guestBookings
      .filter((booking) => booking.guest_customer_id === customerId)
      .map((booking) => booking.id),
  );
  return rows.filter(
    (row) =>
      row.source_type !== "daily_booking" ||
      (row.source_id !== null && explicitGuestIds.has(row.source_id)),
  );
}
