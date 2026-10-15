"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { CustomerRow, DailyBookingRow, PaymentRow, UnitRow } from "@/types/database";
import type { CustomerSummary } from "./calendar";
import { SegmentedControl } from "@/components/ui/operational";
import type { CalendarFinanceSnapshot } from "./calendar-finance-model";
import {
  decodeCalendarWindow,
  sameCalendarWindow,
  type CalendarWindowData,
} from "./calendar-window-model";

const DailyCalendar = dynamic(() => import("./calendar").then((module) => module.DailyCalendar));
const MobileDailyCards = dynamic(() =>
  import("@/features/mobile/mobile-daily-cards").then((module) => module.MobileDailyCards),
);

interface DailyRentalsResponsiveViewProps {
  dailyUnits: UnitRow[];
  unitLookupUnits?: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerSummary[];
  cleaningTasks: {
    id: string;
    unit_id: string;
    daily_booking_id: string | null;
    is_completed: boolean;
  }[];
  payments: {
    id: string;
    source_id: string;
    amount: number;
    payment_date: string;
    reversal_of_payment_id: string | null;
    unit_id?: string | null;
  }[];
  locale: Locale;
  userRole?: string;
  buildings: { id: string; code: string; display_name: string }[];
  initialIsDesktop: boolean;
  financeSnapshots?: Record<string, CalendarFinanceSnapshot>;
  initialWindow?: CalendarWindowData;
}

export function DailyRentalsResponsiveView({
  dailyUnits: initialDailyUnits,
  unitLookupUnits: initialLookupUnits,
  bookings: initialBookings,
  customers,
  cleaningTasks: initialCleaningTasks,
  payments: initialPayments,
  locale,
  userRole,
  buildings,
  initialIsDesktop,
  financeSnapshots,
  initialWindow,
}: DailyRentalsResponsiveViewProps) {
  const [isDesktop, setIsDesktop] = useState(initialIsDesktop);
  const [selectedBuildingId, setSelectedBuildingId] = useState(
    () => buildings.find((building) => building.code === "SACSI11")?.id ?? buildings[0]?.id ?? "",
  );
  const [windowData, setWindowData] = useState(initialWindow);
  const [range, setRange] = useState(() => ({
    from: initialWindow?.from ?? "",
    to: initialWindow?.to ?? "",
  }));
  const [pending, setPending] = useState(false);
  const [windowError, setWindowError] = useState(false);
  const [retry, setRetry] = useState(0);
  const consumedInitial = useRef<CalendarWindowData | null>(null);
  const onVisibleRangeChange = useCallback((from: string, to: string) => {
    setRange((previous) =>
      previous.from === from && previous.to === to ? previous : { from, to },
    );
  }, []);
  useEffect(() => {
    if (!initialWindow) return;
    const query = { buildingId: selectedBuildingId, ...range };
    const freshInitial = consumedInitial.current !== initialWindow;
    consumedInitial.current = initialWindow;
    if (freshInitial && retry === 0 && sameCalendarWindow(initialWindow, query)) {
      setWindowData(initialWindow);
      setPending(false);
      setWindowError(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setPending(true);
    setWindowError(false);
    fetch(`/api/daily-rentals/calendar?${new URLSearchParams(query)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("CalendarWindowUnavailable");
        return decodeCalendarWindow(await response.json(), query);
      })
      .then((data) => {
        if (active) {
          setWindowData(data);
          setPending(false);
        }
      })
      .catch(() => {
        if (active) {
          setWindowError(true);
          setPending(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialWindow, selectedBuildingId, range, retry]);
  const currentWindow = windowData?.buildingId === selectedBuildingId ? windowData : undefined;
  const dailyUnits = currentWindow?.dailyUnits ?? initialDailyUnits;
  const unitLookupUnits = currentWindow?.unitLookupUnits ?? initialLookupUnits;
  const bookings = currentWindow?.bookings ?? initialBookings;
  const cleaningTasks = currentWindow?.cleaningTasks ?? initialCleaningTasks;
  const payments = currentWindow?.payments ?? initialPayments;
  const windowPending = Boolean(
    initialWindow &&
    (pending ||
      !currentWindow ||
      !sameCalendarWindow(currentWindow, { buildingId: selectedBuildingId, ...range })),
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

  const selectedBuilding =
    buildings.find((building) => building.id === selectedBuildingId) ?? buildings[0];
  const scopedDailyUnits = useMemo(
    () => dailyUnits.filter((unit) => unit.building_id === selectedBuildingId),
    [dailyUnits, selectedBuildingId],
  );
  const scopedLookupUnits = useMemo(
    () => (unitLookupUnits ?? dailyUnits).filter((unit) => unit.building_id === selectedBuildingId),
    [dailyUnits, selectedBuildingId, unitLookupUnits],
  );
  const scopedUnitIds = useMemo(
    () => new Set(scopedLookupUnits.map((unit) => unit.id)),
    [scopedLookupUnits],
  );
  const scopedBookings = useMemo(
    () => bookings.filter((booking) => scopedUnitIds.has(booking.unit_id)),
    [bookings, scopedUnitIds],
  );
  const scopedBookingIds = useMemo(
    () => new Set(scopedBookings.map((booking) => booking.id)),
    [scopedBookings],
  );
  const scopedPayments = useMemo(
    () =>
      payments.filter(
        (payment) =>
          scopedBookingIds.has(payment.source_id) ||
          (payment.unit_id && scopedUnitIds.has(payment.unit_id)),
      ),
    [payments, scopedBookingIds, scopedUnitIds],
  );
  const scopedCleaningTasks = useMemo(
    () => cleaningTasks.filter((task) => scopedUnitIds.has(task.unit_id)),
    [cleaningTasks, scopedUnitIds],
  );

  const content =
    initialWindow && !currentWindow ? (
      <div
        role={windowError ? "alert" : "status"}
        className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
      >
        {windowError
          ? locale === "zh"
            ? "日历读取失败，房态未知。"
            : "Calendrier indisponible ; état inconnu."
          : locale === "zh"
            ? "正在读取日历…"
            : "Chargement du calendrier…"}
        {windowError && (
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => setRetry((value) => value + 1)}
          >
            {locale === "zh" ? "重试" : "Réessayer"}
          </button>
        )}
      </div>
    ) : !isDesktop && (windowPending || windowError) ? (
      <div
        role={windowError ? "alert" : "status"}
        className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
      >
        {windowError
          ? locale === "zh"
            ? "日历读取失败，房态未知。"
            : "Calendrier indisponible ; état inconnu."
          : locale === "zh"
            ? "正在读取日历…"
            : "Chargement du calendrier…"}
        {windowError && (
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => setRetry((value) => value + 1)}
          >
            {locale === "zh" ? "重试" : "Réessayer"}
          </button>
        )}
      </div>
    ) : !isDesktop ? (
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
        financeSnapshot={currentWindow?.financeSnapshot ?? financeSnapshots?.[selectedBuildingId]}
        onVisibleRangeChange={initialWindow ? onVisibleRangeChange : undefined}
        windowPending={windowPending}
        windowError={windowError}
        onRetryWindow={() => setRetry((value) => value + 1)}
      />
    );

  return (
    <div className="space-y-4">
      <SegmentedControl
        value={selectedBuildingId}
        onChange={(id) => {
          setSelectedBuildingId(id);
          if (initialWindow) setRange({ from: initialWindow.from, to: initialWindow.to });
        }}
        ariaLabel={locale === "zh" ? "日租楼栋" : "Bâtiment location journalière"}
        items={buildings.map((building) => ({
          value: building.id,
          label: building.display_name,
          count:
            windowData?.buildingCounts[building.id] ??
            initialWindow?.buildingCounts[building.id] ??
            dailyUnits.filter((unit) => unit.building_id === building.id).length,
        }))}
      />
      <div key={selectedBuildingId}>{content}</div>
    </div>
  );
}
