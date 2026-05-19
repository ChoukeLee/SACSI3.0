"use client";

import type { Locale } from "@/lib/i18n";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import { MobileTodayWorkspace } from "./mobile-today-workspace";

interface MobileDailyCardsProps {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  locale: Locale;
}

/**
 * Mobile daily cards — room-centric daily rental cards view.
 * Rebuilt as a thin wrapper around MobileTodayWorkspace.
 */
export function MobileDailyCards(props: MobileDailyCardsProps) {
  return (
    <MobileTodayWorkspace
      dailyUnits={props.dailyUnits}
      bookings={props.bookings}
      customers={props.customers}
      payments={props.payments}
      cleaningTasks={props.cleaningTasks}
      locale={props.locale}
    />
  );
}
