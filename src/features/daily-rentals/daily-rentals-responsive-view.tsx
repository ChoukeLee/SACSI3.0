"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Locale } from "@/lib/i18n";
import type { CustomerRow, DailyBookingRow, PaymentRow, UnitRow } from "@/types/database";
import type { CustomerSummary } from "./calendar";
import { MobileDailyCards } from "@/features/mobile";
import { CalendarSkeleton } from "./calendar-skeleton";

/**
 * Lazy-load the heavy calendar component.
 * The 1287-line DailyCalendar is code-split and loaded only when needed,
 * with a skeleton shown during download.
 */
const DailyCalendar = dynamic(() => import("./calendar").then((mod) => ({ default: mod.DailyCalendar })), {
  loading: () => <CalendarSkeleton locale="zh" />,
  ssr: false,
});

interface DailyRentalsResponsiveViewProps {
  dailyUnits: UnitRow[];
  unitLookupUnits?: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerSummary[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  payments: { id: string; source_id: string; amount: number; payment_date: string }[];
  locale: Locale;
  userRole?: string;
}

export function DailyRentalsResponsiveView({
  dailyUnits,
  unitLookupUnits,
  bookings,
  customers,
  cleaningTasks,
  payments,
  locale,
  userRole,
}: DailyRentalsResponsiveViewProps) {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const syncViewport = () => setIsDesktop(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  if (!isDesktop) {
    return (
      <MobileDailyCards
        dailyUnits={dailyUnits}
        bookings={bookings}
        customers={customers as unknown as CustomerRow[]}
        payments={payments as unknown as PaymentRow[]}
        cleaningTasks={cleaningTasks}
        locale={locale}
      />
    );
  }

  return (
    <DailyCalendar
      dailyUnits={dailyUnits}
      unitLookupUnits={unitLookupUnits}
      bookings={bookings}
      customers={customers}
      cleaningTasks={cleaningTasks}
      payments={payments}
      locale={locale}
      userRole={userRole}
    />
  );
}
