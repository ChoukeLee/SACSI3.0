"use client";

import type { Locale } from "@/lib/i18n";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import { MobileTodayWorkspace } from "./mobile-today-workspace";

interface MobileWorkbenchProps {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  notifications: { id: string; title: string; body: string; read_at: string | null; created_at: string }[];
  locale: Locale;
}

/**
 * Mobile workbench — room-number-centric daily rental field dashboard.
 * Rebuilt as a thin wrapper around MobileTodayWorkspace.
 */
export function MobileWorkbench(props: MobileWorkbenchProps) {
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
