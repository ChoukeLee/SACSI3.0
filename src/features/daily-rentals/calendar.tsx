"use client";

import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { BookingPanel } from "./booking-panel";

export interface CustomerSummary {
  id: string; name: string; phone: string | null; is_blacklisted: boolean;
}

interface CalendarProps {
  dailyUnits: UnitRow[]; bookings: DailyBookingRow[]; customers: CustomerSummary[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  payments: { id: string; source_id: string; amount: number; payment_date: string }[];
  locale: Locale;
}

/* PERF: booking color classes as module-level constant — avoids object allocation every render */
const BOOKING_COLORS: Record<string, string> = {
  pending_review: "bg-amber-100 text-amber-800",
  confirmed: "bg-blue-100 text-blue-800",
  checked_in_fixed: "bg-orange-200 text-orange-900",
  checked_in_open: "bg-amber-200 text-amber-900",
  checked_out: "bg-brand-ink-100 text-brand-ink-500",
  cancelled: "bg-brand-ink-50 text-brand-ink-300",
};

const MAINTENANCE_STATUSES = new Set(["available", "reserved", "daily_occupied", "cleaning_pending"]);

/* PERF: single shared empty cell class — avoids cn() call per empty cell */
const EMPTY_CELL = "group flex h-11 cursor-pointer items-center justify-center border-b border-r border-black/5 transition-colors duration-fast hover:bg-brand-orange-50 focus-visible:bg-brand-orange-50 focus-visible:outline-none";

const NAV_BTN = "rounded-lg border border-black/10 bg-white p-2 text-brand-ink-500 transition-all duration-fast hover:bg-brand-ink-50 hover:text-brand-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange-500";

export function DailyCalendar({ dailyUnits, bookings, customers, cleaningTasks, payments, locale }: CalendarProps) {
  const t = dictionaries[locale].dailyRentals;
  const statusLabels = dictionaries[locale].statuses;
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [newBookingUnitId, setNewBookingUnitId] = useState<string | null>(null);
  const [newBookingDate, setNewBookingDate] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /* PERF: pre-compute date strings once per month change, avoid toISOString in render loop */
  const { dayStrings, daysInMonth } = useMemo(() => {
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const days: Date[] = [];
    const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    while (d <= monthEnd) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
    const todayStr = new Date().toISOString().slice(0, 10);
    const tomorrowStr = (() => { const t = new Date(todayStr); t.setDate(t.getDate() + 1); return t.toISOString().slice(0, 10); })();
    return {
      daysInMonth: days,
      dayStrings: { todayStr, tomorrowStr, days },
      monthEnd,
    };
  }, [currentMonth]);

  const { todayStr, tomorrowStr } = dayStrings;

  /* PERF: O(1) booking lookup — build Map<unitId, Map<dateStr, booking>> once, not per cell */
  const bookingMap = useMemo(() => {
    const map = new Map<string, Map<string, DailyBookingRow>>();
    for (const b of bookings) {
      if (!map.has(b.unit_id)) map.set(b.unit_id, new Map());
      const bCheckOut = b.checkout_mode === "open"
        ? (b.actual_check_out ?? tomorrowStr)
        : (b.check_out ?? todayStr);
      const start = new Date(b.check_in);
      const end = new Date(bCheckOut);
      const cursor = new Date(start);
      while (cursor < end) {
        const ds = cursor.toISOString().slice(0, 10);
        map.get(b.unit_id)!.set(ds, b);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [bookings, todayStr, tomorrowStr]);

  /* PERF: O(1) customer abbreviation lookup — Map<id, abbr> pre-built once */
  const abbrMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name.length > 3 ? c.name.slice(0, 3) : c.name);
    return map;
  }, [customers]);

  /* PERF: pre-compute unit status flags — avoid array.includes per cell */
  const unitStatusMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const u of dailyUnits) map.set(u.id, MAINTENANCE_STATUSES.has(u.status) ? null : u.status);
    return map;
  }, [dailyUnits]);

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
          <button onClick={goToToday} className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-brand-ink-500 transition-all duration-fast hover:bg-brand-ink-50 focus-visible:outline-2 focus-visible:outline-brand-orange-500">{t.calendar.today}</button>
        </div>
        <div className="hidden items-center gap-3 text-xs text-brand-ink-500 sm:flex">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-100 border border-emerald-300" />{t.calendar.legendAvailable}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-100 border border-amber-300" />{t.calendar.legendReserved}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-200 border border-orange-400" />{t.calendar.legendBooked}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-100 border border-red-300" />{t.calendar.legendMaintenance}</span>
        </div>
      </div>

      {/* Calendar grid — UX-REFACTOR: scroll-hint-x shows gradient on overflow, data-scroll-x preserves vertical scroll */}
      <div className="overflow-auto rounded-lg border border-black/10 bg-white shadow-card scroll-hint-x" style={{ maxHeight: "calc(100vh - 200px)" }} data-scroll-x>
        <div className="grid" style={{ gridTemplateColumns: `64px repeat(${daysInMonth.length}, 64px)` }} role="grid" aria-label={t.calendar.room}>
          {/* Header row */}
          <div className="sticky left-0 top-0 z-30 flex h-8 items-center justify-center border-b border-r border-black/10 bg-brand-ink-100 text-[10px] font-semibold uppercase tracking-wider text-brand-ink-500" role="columnheader">{t.calendar.room}</div>
          {daysInMonth.map(date => {
            const dateStr = date.toISOString().slice(0, 10);
            const isToday = dateStr === todayStr;
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            return (
              <div key={dateStr} className={cn(
                "sticky top-0 z-20 flex h-8 flex-col items-center justify-center border-b border-r border-black/10 text-[10px]",
                isToday && "bg-brand-orange-50 font-bold text-brand-orange-500",
                isWeekend && !isToday && "bg-brand-ink-50 text-brand-ink-300",
                !isToday && !isWeekend && "bg-white text-brand-ink-500"
              )} role="columnheader">
                <span>{date.getDate()}</span>
                <span className="text-[8px] opacity-60">{date.toLocaleDateString(localeStr, { weekday: "short" })}</span>
              </div>
            );
          })}

          {/* Room rows */}
          {dailyUnits.map(unit => (
            <div key={unit.id} className="contents" role="row">
              <div className="sticky left-0 z-10 flex h-11 items-center justify-center border-b border-r border-black/10 bg-brand-ink-50 text-xs font-semibold text-brand-ink-900" role="rowheader">{unit.unit_no}</div>
              {daysInMonth.map(date => {
                const dateStr = date.toISOString().slice(0, 10);
                /* PERF: O(1) Map lookup instead of O(n) array scan */
                const unitBM = bookingMap.get(unit.id);
                const booking = unitBM?.get(dateStr) ?? null;
                /* PERF: O(1) pre-computed status lookup */
                const unitStatus = unitStatusMap.get(unit.id);

                if (unitStatus) {
                  return <div key={dateStr} className="flex h-11 items-center justify-center border-b border-r border-black/5 bg-red-50 text-[9px] font-medium text-red-600" title={statusLabels[unitStatus as UnitStatus]} role="gridcell">{statusLabels[unitStatus as UnitStatus].slice(0, 2)}</div>;
                }

                if (booking) {
                  /* PERF: inline style computation avoids function call overhead per cell */
                  const isStart = dateStr === booking.check_in;
                  const status = booking.status;
                  let colorClass: string;
                  if (status === "checked_in" && booking.checkout_mode === "open") colorClass = BOOKING_COLORS.checked_in_open;
                  else if (status === "checked_in") colorClass = BOOKING_COLORS.checked_in_fixed;
                  else colorClass = BOOKING_COLORS[status] ?? BOOKING_COLORS.pending_review;
                  const isEnd = booking.checkout_mode !== "open" && booking.check_out && dateStr === (() => { const d = new Date(booking.check_out!); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
                  const abbr = abbrMap.get(booking.customer_id) ?? "?";
                  return (
                    <div key={dateStr}
                      className={`flex h-11 items-center justify-center text-[10px] font-medium cursor-pointer border-b border-r border-black/5 active:opacity-80 ${colorClass} ${isStart ? "rounded-l" : ""} ${isEnd ? "rounded-r" : ""}`}
                      onClick={() => { setSelectedBookingId(booking.id); setNewBookingUnitId(null); setNewBookingDate(null); }}
                      title={`${abbr} — ${booking.check_in} → ${booking.checkout_mode === "open" ? "?" : booking.check_out}`}
                      role="gridcell" tabIndex={0} aria-label={`${abbr} ${booking.check_in}`}
                      onKeyDown={e => { if (e.key === "Enter") { setSelectedBookingId(booking.id); setNewBookingUnitId(null); setNewBookingDate(null); } }}
                    >
                      {isStart ? abbr : ""}
                    </div>
                  );
                }

                return (
                  <div key={dateStr} className={EMPTY_CELL}
                    onClick={() => { setNewBookingUnitId(unit.id); setNewBookingDate(dateStr); setSelectedBookingId(null); }}
                    role="gridcell" tabIndex={0} aria-label={`${unit.unit_no} ${dateStr}`}
                    onKeyDown={e => { if (e.key === "Enter") { setNewBookingUnitId(unit.id); setNewBookingDate(dateStr); setSelectedBookingId(null); } }}
                  >
                    <Plus className="hidden h-3 w-3 text-brand-orange-500 group-hover:block group-focus-visible:block" />
                  </div>
                );
              })}
            </div>
          ))}
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
        />
      )}
    </div>
  );
}
