"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { CustomerRow, DailyBookingRow, PaymentRow, UnitRow } from "@/types/database";
import type { CustomerSummary } from "./calendar";
import { SegmentedControl } from "@/components/ui/operational";

const DailyCalendar = dynamic(() => import("./calendar").then((module) => module.DailyCalendar));
const MobileDailyCards = dynamic(() => import("@/features/mobile/mobile-daily-cards").then((module) => module.MobileDailyCards));

interface DailyRentalsResponsiveViewProps {
  dailyUnits: UnitRow[];
  unitLookupUnits?: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerSummary[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  payments: { id: string; source_id: string; amount: number; payment_date: string }[];
  locale: Locale;
  userRole?: string;
  buildings: { id: string; code: string; display_name: string }[];
  initialIsDesktop: boolean;
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
  buildings,
  initialIsDesktop,
}: DailyRentalsResponsiveViewProps) {
  const [isDesktop, setIsDesktop] = useState(initialIsDesktop);
  const [selectedBuildingId, setSelectedBuildingId] = useState(
    () => buildings.find((building) => building.code === "SACSI11")?.id ?? buildings[0]?.id ?? "",
  );

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const syncViewport = () => setIsDesktop(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (!buildings.some((building) => building.id === selectedBuildingId)) {
      setSelectedBuildingId(buildings[0]?.id ?? "");
    }
  }, [buildings, selectedBuildingId]);

  const selectedBuilding = buildings.find((building) => building.id === selectedBuildingId) ?? buildings[0];
  const scopedDailyUnits = useMemo(
    () => dailyUnits.filter((unit) => unit.building_id === selectedBuildingId),
    [dailyUnits, selectedBuildingId],
  );
  const scopedLookupUnits = useMemo(
    () => (unitLookupUnits ?? dailyUnits).filter((unit) => unit.building_id === selectedBuildingId),
    [dailyUnits, selectedBuildingId, unitLookupUnits],
  );
  const scopedUnitIds = useMemo(() => new Set(scopedLookupUnits.map((unit) => unit.id)), [scopedLookupUnits]);
  const scopedBookings = useMemo(
    () => bookings.filter((booking) => scopedUnitIds.has(booking.unit_id)),
    [bookings, scopedUnitIds],
  );
  const scopedBookingIds = useMemo(() => new Set(scopedBookings.map((booking) => booking.id)), [scopedBookings]);
  const scopedPayments = useMemo(
    () => payments.filter((payment) => scopedBookingIds.has(payment.source_id)),
    [payments, scopedBookingIds],
  );
  const scopedCleaningTasks = useMemo(
    () => cleaningTasks.filter((task) => scopedUnitIds.has(task.unit_id)),
    [cleaningTasks, scopedUnitIds],
  );

  const content = !isDesktop ? (
      <MobileDailyCards
        dailyUnits={scopedDailyUnits}
        bookings={scopedBookings}
        customers={customers as unknown as CustomerRow[]}
        payments={scopedPayments as unknown as PaymentRow[]}
        cleaningTasks={scopedCleaningTasks}
        locale={locale}
      />
  ) : (
    <DailyCalendar
      dailyUnits={scopedDailyUnits}
      unitLookupUnits={scopedLookupUnits}
      bookings={scopedBookings}
      customers={customers}
      cleaningTasks={scopedCleaningTasks}
      payments={scopedPayments}
      locale={locale}
      userRole={userRole}
      buildingLabel={selectedBuilding?.display_name}
    />
  );

  return (
    <div className="space-y-4">
      <SegmentedControl
        value={selectedBuildingId}
        onChange={setSelectedBuildingId}
        ariaLabel={locale === "zh" ? "日租楼栋" : "Bâtiment location journalière"}
        items={buildings.map((building) => ({
          value: building.id,
          label: building.display_name,
          count: dailyUnits.filter((unit) => unit.building_id === building.id).length,
        }))}
      />
      <div key={selectedBuildingId}>{content}</div>
    </div>
  );
}
