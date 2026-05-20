"use client";

import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { BookingPanel } from "./booking-panel";
import { buildBookingMap, getBookingColorClass } from "./room-status";

export interface CustomerSummary {
  id: string; name: string; phone: string | null; is_blacklisted: boolean;
}

interface CalendarProps {
  dailyUnits: UnitRow[]; bookings: DailyBookingRow[]; customers: CustomerSummary[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  payments: { id: string; source_id: string; amount: number; payment_date: string }[];
  locale: Locale;
}

const MAINTENANCE_STATUSES = new Set(["available", "reserved", "daily_occupied", "cleaning_pending"]);

const EMPTY_CELL = "group flex h-11 cursor-pointer items-center justify-center border-b border-r border-brand-warm-400 transition-colors duration-fast hover:bg-brand-orange-50 focus-visible:bg-brand-orange-50 focus-visible:outline-none";

const NAV_BTN = "rounded-lg border border-brand-warm-400 bg-white p-2 text-brand-ink-500 transition-all duration-fast hover:bg-brand-warm-50 hover:text-brand-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

export function DailyCalendar({ dailyUnits, bookings: serverBookings, customers, cleaningTasks, payments, locale }: CalendarProps) {
  const t = dictionaries[locale].dailyRentals;
  const statusLabels = dictionaries[locale].statuses;
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [newBookingUnitId, setNewBookingUnitId] = useState<string | null>(null);
  const [newBookingDate, setNewBookingDate] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Optimistic state: newly created bookings appear immediately before server re-fetch.
  const [optimisticBookings, setOptimisticBookings] = useState<DailyBookingRow[]>([]);

  // Merge server + optimistic bookings, dedup by id
  const bookings = useMemo(() => {
    const seen = new Set(optimisticBookings.map(b => b.id));
    return [...optimisticBookings, ...serverBookings.filter(b => !seen.has(b.id))];
  }, [serverBookings, optimisticBookings]);

  const { dayStrings, daysInMonth, visibleEndExclusiveStr } = useMemo(() => {
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const days: Date[] = [];
    const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    while (d <= monthEnd) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
    const todayStr = toDateStr(new Date());
    const tomorrowStr = toDateStr(new Date(Date.now() + 86400000));
    const visibleEndExclusive = new Date(monthEnd);
    visibleEndExclusive.setDate(visibleEndExclusive.getDate() + 1);
    return {
      daysInMonth: days,
      dayStrings: { todayStr, tomorrowStr, days },
      visibleEndExclusiveStr: toDateStr(visibleEndExclusive),
    };
  }, [currentMonth]);

  const { todayStr, tomorrowStr } = dayStrings;

  const bookingMap = useMemo(
    () => buildBookingMap(bookings, { todayStr, tomorrowStr, visibleEndExclusiveStr }),
    [bookings, todayStr, tomorrowStr, visibleEndExclusiveStr],
  );

  const abbrMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name.length > 3 ? c.name.slice(0, 3) : c.name);
    return map;
  }, [customers]);

  const unitCleaningMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const t of cleaningTasks) {
      if (!t.is_completed) map.set(t.unit_id, true);
    }
    return map;
  }, [cleaningTasks]);

  const panelBooking = selectedBookingId ? bookings.find(b => b.id === selectedBookingId) ?? null : null;

  const monthLabel = currentMonth.toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { year: "numeric", month: "long" });
  const localeStr = locale === "fr" ? "fr-FR" : "zh-CN";

  const goToMonth = useCallback((offset: number) => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  }, []);

  const goToToday = useCallback(() => {
    setCurrentMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  }, []);

  if (dailyUnits.length === 0) {
    return <div className="flex flex-col items-center gap-3 py-16 text-center"><p className="text-sm text-brand-ink-300">{t.calendar.noRooms}</p></div>;
  }

  return (
    <div>
      {/* Month navigation */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => goToMonth(-1)} className={NAV_BTN} aria-label={t.calendar.prevMonth}><ChevronLeft className="h-4 w-4" /></button>
          <h3 className="text-base font-bold text-brand-ink-900">{monthLabel}</h3>
          <button onClick={() => goToMonth(1)} className={NAV_BTN} aria-label={t.calendar.nextMonth}><ChevronRight className="h-4 w-4" /></button>
          <button onClick={goToToday} className="rounded-lg border border-brand-warm-400 bg-white px-3 py-1.5 text-xs font-medium text-brand-ink-500 transition-all duration-fast hover:bg-brand-warm-50 focus-visible:outline-2 focus-visible:outline-brand-orange">{t.calendar.today}</button>
        </div>
        <div className="hidden items-center gap-3 text-xs text-brand-ink-500 sm:flex">
          <Legend color="bg-brand-green-100 border-brand-green-300" label={t.calendar.legendAvailable} />
          <Legend color="bg-amber-200 border-amber-300" label={t.calendar.legendReserved} />
          <Legend color="bg-brand-orange-200 border-brand-orange-400" label={t.calendar.legendBooked} />
          <Legend color="bg-brand-red-100 border-brand-red-300" label={t.calendar.legendMaintenance} />
          <Legend color="bg-brand-sky-100 border-brand-sky-300" label={t.cleaning.pending} />
        </div>
      </div>

      {/* Calendar grid */}
      <div className="overflow-auto rounded-xl border border-brand-warm-400 bg-white shadow-card scroll-hint-x" style={{ maxHeight: "calc(100vh - 200px)" }} data-scroll-x>
        <div className="grid" style={{ gridTemplateColumns: `64px repeat(${daysInMonth.length}, 64px)` }} role="grid" aria-label={t.calendar.room}>
          {/* Header row */}
          <div className="sticky left-0 top-0 z-30 flex h-8 items-center justify-center border-b border-r border-brand-warm-400 bg-brand-warm-100 text-[10px] font-semibold uppercase tracking-wider text-brand-ink-400" role="columnheader">{t.calendar.room}</div>
          {daysInMonth.map(date => {
            const dateStr = toDateStr(date);
            const isToday = dateStr === todayStr;
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            return (
              <div key={dateStr} className={cn(
                "sticky top-0 z-20 flex h-8 flex-col items-center justify-center border-b border-r border-brand-warm-400 text-[10px]",
                isToday && "bg-brand-orange-50 font-bold text-brand-orange-700",
                isWeekend && !isToday && "bg-brand-warm-50 text-brand-ink-300",
                !isToday && !isWeekend && "bg-white text-brand-ink-500"
              )} role="columnheader">
                <span>{date.getDate()}</span>
                <span className="text-[8px] opacity-60">{date.toLocaleDateString(localeStr, { weekday: "short" })}</span>
              </div>
            );
          })}

          {/* Room rows */}
          {dailyUnits.map(unit => {
            const unitBM = bookingMap.get(unit.id);
            const hasCleaning = unitCleaningMap.get(unit.id) === true;
            return (
            <div key={unit.id} className="contents" role="row">
              <div className="sticky left-0 z-10 flex h-11 items-center justify-center border-b border-r border-brand-warm-400 bg-brand-warm-50 text-xs font-semibold text-brand-ink-900" role="rowheader">{unit.unit_no}</div>
              {daysInMonth.map(date => {
                const dateStr = toDateStr(date);
                const booking = unitBM?.get(dateStr) ?? null;
                const isMaintenance = !MAINTENANCE_STATUSES.has(unit.status);

                // 1. Maintenance / locked
                if (isMaintenance) {
                  return <div key={dateStr} className="flex h-11 items-center justify-center border-b border-r border-brand-warm-400 bg-brand-red-50 text-[9px] font-medium text-brand-red-600" title={statusLabels[unit.status as UnitStatus]} role="gridcell">{statusLabels[unit.status as UnitStatus]?.slice(0, 2)}</div>;
                }

                // 2. Active booking
                if (booking && booking.status !== "checked_out") {
                  const isStart = dateStr === booking.check_in;
                  const isEnd = booking.checkout_mode === "fixed" && booking.check_out === dateStr;
                  const colorClass = getBookingColorClass(booking);
                  const abbr = abbrMap.get(booking.customer_id) ?? "?";
                  return (
                    <div key={dateStr}
                      className={`flex h-11 items-center justify-center text-[10px] font-medium cursor-pointer border-b border-r border-brand-warm-400 active:opacity-80 ${colorClass} ${isStart ? "rounded-l" : ""} ${isEnd ? "rounded-r" : ""}`}
                      onClick={() => { setSelectedBookingId(booking.id); setNewBookingUnitId(null); setNewBookingDate(null); }}
                      title={isStart ? `${abbr} — ${booking.check_in} → ${booking.checkout_mode === "open" ? "?" : booking.check_out}` : abbr}
                      role="gridcell" tabIndex={0} aria-label={`${abbr} ${booking.check_in}`}
                      onKeyDown={e => { if (e.key === "Enter") { setSelectedBookingId(booking.id); setNewBookingUnitId(null); setNewBookingDate(null); } }}
                    >
                      {isStart ? abbr : ""}
                    </div>
                  );
                }

                // 3. Checked-out booking (grey, subtle)
                if (booking && booking.status === "checked_out") {
                  return (
                    <div key={dateStr}
                      className="flex h-11 items-center justify-center text-[10px] cursor-pointer border-b border-r border-brand-warm-400 bg-brand-warm-50 text-brand-ink-300"
                      onClick={() => { setSelectedBookingId(booking.id); setNewBookingUnitId(null); setNewBookingDate(null); }}
                      role="gridcell" tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter") { setSelectedBookingId(booking.id); setNewBookingUnitId(null); setNewBookingDate(null); } }}
                    >
                      {dateStr === booking.check_in ? (abbrMap.get(booking.customer_id) ?? "?") : ""}
                    </div>
                  );
                }

                // 4. Cleaning pending (no active booking)
                if (hasCleaning || unit.status === "cleaning_pending") {
                  return <div key={dateStr} className="flex h-11 items-center justify-center border-b border-r border-brand-warm-400 bg-brand-sky-50 text-[9px] font-medium text-brand-sky-600" title={t.cleaning.pending} role="gridcell">{t.cleaning.pending.slice(0, 2)}</div>;
                }

                // 5. Available
                return (
                  <div key={dateStr} className={EMPTY_CELL}
                    onClick={() => { setNewBookingUnitId(unit.id); setNewBookingDate(dateStr); setSelectedBookingId(null); }}
                    role="gridcell" tabIndex={0} aria-label={`${unit.unit_no} ${dateStr}`}
                    onKeyDown={e => { if (e.key === "Enter") { setNewBookingUnitId(unit.id); setNewBookingDate(dateStr); setSelectedBookingId(null); } }}
                  >
                    <Plus className="hidden h-3 w-3 text-brand-orange group-hover:block group-focus-visible:block" />
                  </div>
                );
              })}
            </div>
          );
          })}
        </div>
      </div>

      {(panelBooking || newBookingUnitId) && (
        <BookingPanel
          key={tick}
          booking={panelBooking} unitId={newBookingUnitId ?? panelBooking?.unit_id ?? null}
          defaultDate={newBookingDate ?? undefined} units={dailyUnits} customers={customers}
          cleaningTasks={cleaningTasks} payments={payments} locale={locale}
          onClose={() => { setSelectedBookingId(null); setNewBookingUnitId(null); setNewBookingDate(null); }}
          onChanged={() => setTick(t => t + 1)}
          onBookingCreated={(b) => setOptimisticBookings(prev => [b, ...prev])}
        />
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("inline-block h-2.5 w-2.5 rounded-sm border", color)} />
      {label}
    </span>
  );
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
