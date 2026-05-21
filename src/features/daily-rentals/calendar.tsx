"use client";

import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { BookingPanel } from "./booking-panel";
import { buildBookingMap } from "./room-status";

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  is_blacklisted: boolean;
}

interface CalendarProps {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerSummary[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  payments: { id: string; source_id: string; amount: number; payment_date: string }[];
  locale: Locale;
}

const ROOM_COL_WIDTH = 176;
const DAY_COL_WIDTH = 92;
const MAINTENANCE_STATUSES = new Set(["available", "reserved", "daily_occupied", "cleaning_pending"]);

const NAV_BTN =
  "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-fast hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500";

const COPY = {
  zh: {
    noRooms: "暂无日租房源",
    timeline: "预订时间轴",
    subtitle: "按房间和日期查看预订、入住、保洁和维修状态",
    roomType: "房间 / 状态",
    allRooms: "全部房间",
    day: "天",
    week: "周",
    month: "月",
    today: "今天",
    arrive: "今日到达",
    depart: "今日离开",
    occupied: "占用中",
    maintenance: "维修",
    available: "空闲",
    total: "总房源",
    clean: "可预订",
    reserved: "预订",
    booked: "入住",
    cleaning: "待保洁",
    openEnded: "未定离店",
    room: "房间",
    floor: "楼",
    apartment: "公寓",
  },
  fr: {
    noRooms: "Aucune chambre journaliere",
    timeline: "Planning des reservations",
    subtitle: "Reservations, arrivees, menage et maintenance par chambre",
    roomType: "Chambre / statut",
    allRooms: "Toutes",
    day: "Jour",
    week: "Semaine",
    month: "Mois",
    today: "Aujourd'hui",
    arrive: "Arrivees",
    depart: "Departs",
    occupied: "Occupees",
    maintenance: "Maintenance",
    available: "Libres",
    total: "Total",
    clean: "Disponible",
    reserved: "Reserve",
    booked: "Occupe",
    cleaning: "Menage",
    openEnded: "Ouvert",
    room: "Chambre",
    floor: "Etage",
    apartment: "Appartement",
  },
} as const;

const UNIT_STATUS_LABELS: Record<Locale, Record<UnitStatus, string>> = {
  zh: {
    available: "可预订",
    reserved: "已预订",
    daily_occupied: "日租中",
    cleaning_pending: "待保洁",
    leased: "长租中",
    sold: "已售",
    maintenance: "维修",
    locked: "锁定",
  },
  fr: {
    available: "Disponible",
    reserved: "Reserve",
    daily_occupied: "Occupe",
    cleaning_pending: "Menage",
    leased: "Bail long",
    sold: "Vendu",
    maintenance: "Maintenance",
    locked: "Bloque",
  },
};

const BOOKING_STATUS_LABELS: Record<Locale, Record<string, string>> = {
  zh: {
    pending_review: "待审核",
    confirmed: "已确认",
    checked_in: "已入住",
    checked_out: "已退房",
    cancelled: "已取消",
  },
  fr: {
    pending_review: "A valider",
    confirmed: "Confirme",
    checked_in: "Arrive",
    checked_out: "Parti",
    cancelled: "Annule",
  },
};

export function DailyCalendar({
  dailyUnits,
  bookings: serverBookings,
  customers,
  cleaningTasks,
  payments,
  locale,
}: CalendarProps) {
  const copy = COPY[locale];
  const statusLabels = UNIT_STATUS_LABELS[locale];
  const bookingLabels = BOOKING_STATUS_LABELS[locale];
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [newBookingUnitId, setNewBookingUnitId] = useState<string | null>(null);
  const [newBookingDate, setNewBookingDate] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [optimisticBookings, setOptimisticBookings] = useState<DailyBookingRow[]>([]);

  const bookings = useMemo(() => {
    const seen = new Set(optimisticBookings.map((b) => b.id));
    return [...optimisticBookings, ...serverBookings.filter((b) => !seen.has(b.id))];
  }, [serverBookings, optimisticBookings]);

  const { daysInMonth, visibleEndExclusiveStr } = useMemo(() => {
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const days: Date[] = [];
    const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    while (d <= monthEnd) {
      days.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    const visibleEndExclusive = new Date(monthEnd);
    visibleEndExclusive.setDate(visibleEndExclusive.getDate() + 1);
    return {
      daysInMonth: days,
      visibleEndExclusiveStr: toDateStr(visibleEndExclusive),
    };
  }, [currentMonth]);

  const todayStr = toDateStr(new Date());
  const tomorrowStr = toDateStr(new Date(Date.now() + 86400000));

  const bookingMap = useMemo(
    () => buildBookingMap(bookings, { todayStr, tomorrowStr, visibleEndExclusiveStr }),
    [bookings, todayStr, tomorrowStr, visibleEndExclusiveStr],
  );

  const customerMap = useMemo(() => {
    const map = new Map<string, CustomerSummary>();
    for (const customer of customers) map.set(customer.id, customer);
    return map;
  }, [customers]);

  const unitCleaningMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const task of cleaningTasks) {
      if (!task.is_completed) map.set(task.unit_id, true);
    }
    return map;
  }, [cleaningTasks]);

  const unitsByFloor = useMemo(() => {
    const grouped = new Map<string, UnitRow[]>();
    for (const unit of dailyUnits) {
      const floor = normalizeFloorLabel(unit.floor_label, unit.unit_no);
      if (!grouped.has(floor)) grouped.set(floor, []);
      grouped.get(floor)!.push(unit);
    }
    return Array.from(grouped.entries()).sort((a, b) => floorSortValue(a[0]) - floorSortValue(b[0]));
  }, [dailyUnits]);

  const panelBooking = selectedBookingId ? bookings.find((b) => b.id === selectedBookingId) ?? null : null;
  const localeStr = locale === "fr" ? "fr-FR" : "zh-CN";
  const monthLabel = currentMonth.toLocaleDateString(localeStr, { year: "numeric", month: "long" });

  const goToMonth = useCallback((offset: number) => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  }, []);

  const goToToday = useCallback(() => {
    setCurrentMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  }, []);

  const todayStats = useMemo(() => {
    let arriving = 0;
    let departing = 0;
    let occupied = 0;

    for (const unit of dailyUnits) {
      const todayBooking = bookingMap.get(unit.id)?.get(todayStr) ?? null;
      if (!todayBooking || todayBooking.status === "checked_out") continue;

      if (todayBooking.check_in === todayStr) arriving += 1;
      if (todayBooking.checkout_mode === "fixed" && todayBooking.check_out === todayStr) departing += 1;
      if (todayBooking.status === "checked_in" || todayBooking.status === "confirmed" || todayBooking.status === "pending_review") {
        occupied += 1;
      }
    }

    const maintenance = dailyUnits.filter((unit) => !MAINTENANCE_STATUSES.has(unit.status)).length;
    const cleaning = dailyUnits.filter((unit) => unitCleaningMap.get(unit.id) === true || unit.status === "cleaning_pending").length;
    const available = Math.max(0, dailyUnits.length - occupied - maintenance - cleaning);

    return { arriving, departing, occupied, maintenance, cleaning, available, total: dailyUnits.length };
  }, [dailyUnits, bookingMap, todayStr, unitCleaningMap]);

  if (dailyUnits.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[28px] border border-slate-200 bg-white py-16 text-center shadow-sm">
        <p className="text-sm text-slate-500">{copy.noRooms}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <QuickStat label={copy.arrive} value={todayStats.arriving} tone="sky" />
        <QuickStat label={copy.depart} value={todayStats.departing} tone="amber" />
        <QuickStat label={copy.occupied} value={todayStats.occupied} tone="violet" />
        <QuickStat label={copy.cleaning} value={todayStats.cleaning} tone="cyan" />
        <QuickStat label={copy.available} value={todayStats.available} tone="emerald" />
        <QuickStat label={copy.total} value={todayStats.total} tone="slate" />
      </div>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50/80 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-[22px] font-black tracking-tight text-slate-950">{copy.timeline}</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">{copy.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm"
            >
              <SlidersHorizontal className="h-4 w-4 text-slate-400" />
              {copy.allRooms}
            </button>
            <LegendPill color="bg-emerald-400" label={copy.clean} />
            <LegendPill color="bg-violet-500" label={copy.booked} />
            <LegendPill color="bg-amber-400" label={copy.reserved} />
            <LegendPill color="bg-cyan-400" label={copy.cleaning} />
            <LegendPill color="bg-rose-400" label={copy.maintenance} />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-100 p-1 text-xs font-bold text-slate-500">
            <span className="rounded-lg bg-white px-3 py-1.5 text-slate-950 shadow-sm">{copy.day}</span>
            <span className="px-3 py-1.5">{copy.week}</span>
            <span className="px-3 py-1.5">{copy.month}</span>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => goToMonth(-1)} className={NAV_BTN} aria-label="previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-[160px] rounded-xl bg-slate-100 px-4 py-2 text-center text-sm font-black text-slate-950">
              {monthLabel}
            </div>
            <button onClick={() => goToMonth(1)} className={NAV_BTN} aria-label="next month">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={goToToday}
              className="h-9 rounded-xl bg-violet-600 px-4 text-sm font-black text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              {copy.today}
            </button>
          </div>
        </div>

        <div className="scroll-hint-x overflow-auto bg-white" style={{ maxHeight: "calc(100vh - 280px)" }} data-scroll-x>
          <div
            className="grid min-w-max"
            style={{ gridTemplateColumns: `${ROOM_COL_WIDTH}px repeat(${daysInMonth.length}, ${DAY_COL_WIDTH}px)` }}
            role="grid"
            aria-label={copy.timeline}
          >
            <div className="sticky left-0 top-0 z-30 flex h-16 items-center border-b border-r border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
              {copy.roomType}
            </div>
            {daysInMonth.map((date) => {
              const dateStr = toDateStr(date);
              const isToday = dateStr === todayStr;
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <div
                  key={dateStr}
                  className={cn(
                    "sticky top-0 z-20 flex h-16 flex-col items-center justify-center border-b border-r border-slate-200 text-xs",
                    isToday && "bg-violet-50 text-violet-700",
                    isWeekend && !isToday && "bg-slate-50 text-slate-400",
                    !isToday && !isWeekend && "bg-white text-slate-500",
                  )}
                  role="columnheader"
                >
                  <span className="font-semibold">{date.toLocaleDateString(localeStr, { weekday: "short" })}</span>
                  <span className="mt-1 text-base font-black text-slate-950">{date.getDate()}</span>
                  {isToday && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-violet-600" />}
                </div>
              );
            })}

            {unitsByFloor.flatMap(([floor, units]) => [
              <FloorRow key={`floor-${floor}`} floor={floor} count={units.length} daysCount={daysInMonth.length} copy={copy} />,
              ...units.flatMap((unit) => {
                const unitBM = bookingMap.get(unit.id);
                const hasCleaning = unitCleaningMap.get(unit.id) === true;
                const isMaintenance = !MAINTENANCE_STATUSES.has(unit.status);
                const roomTone = getRoomTone(unit, hasCleaning, isMaintenance);
                const statusLabel = isMaintenance
                  ? statusLabels[unit.status as UnitStatus]
                  : hasCleaning || unit.status === "cleaning_pending"
                    ? copy.cleaning
                    : statusLabels[unit.status as UnitStatus] ?? copy.clean;

                return [
                  <div
                    key={`${unit.id}-room`}
                    className="sticky left-0 z-10 flex h-[68px] items-center border-b border-r border-slate-200 bg-white px-4"
                    role="rowheader"
                  >
                    <span className={cn("mr-3 h-10 w-1 rounded-full", roomTone.strip)} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-950">{copy.room} {unit.unit_no}</div>
                      <div className="mt-1 truncate text-[11px] font-semibold text-slate-500">
                        {statusLabel} · {copy.apartment}
                      </div>
                    </div>
                  </div>,
                  ...daysInMonth.map((date) => {
                    const dateStr = toDateStr(date);
                    const prevDateStr = toDateStr(addDays(date, -1));
                    const nextDateStr = toDateStr(addDays(date, 1));
                    const booking = unitBM?.get(dateStr) ?? null;
                    const prevSame = booking && unitBM?.get(prevDateStr)?.id === booking.id;
                    const nextSame = booking && unitBM?.get(nextDateStr)?.id === booking.id;
                    const isToday = dateStr === todayStr;

                    return (
                      <TimelineCell
                        key={`${unit.id}-${dateStr}`}
                        unit={unit}
                        dateStr={dateStr}
                        booking={booking}
                        customer={booking ? customerMap.get(booking.customer_id) ?? null : null}
                        hasCleaning={hasCleaning}
                        isMaintenance={isMaintenance}
                        isToday={isToday}
                        isStart={!prevSame}
                        isEnd={!nextSame}
                        copy={copy}
                        bookingLabels={bookingLabels}
                        onOpenBooking={(id) => {
                          setSelectedBookingId(id);
                          setNewBookingUnitId(null);
                          setNewBookingDate(null);
                        }}
                        onNewBooking={() => {
                          setNewBookingUnitId(unit.id);
                          setNewBookingDate(dateStr);
                          setSelectedBookingId(null);
                        }}
                      />
                    );
                  }),
                ];
              }),
            ])}
          </div>
        </div>
      </section>

      {(panelBooking || newBookingUnitId) && (
        <BookingPanel
          key={tick}
          booking={panelBooking}
          unitId={newBookingUnitId ?? panelBooking?.unit_id ?? null}
          defaultDate={newBookingDate ?? undefined}
          units={dailyUnits}
          customers={customers}
          cleaningTasks={cleaningTasks}
          payments={payments}
          locale={locale}
          onClose={() => {
            setSelectedBookingId(null);
            setNewBookingUnitId(null);
            setNewBookingDate(null);
          }}
          onChanged={() => setTick((t) => t + 1)}
          onBookingCreated={(booking) => setOptimisticBookings((prev) => [booking, ...prev])}
        />
      )}
    </div>
  );
}

function TimelineCell({
  unit,
  dateStr,
  booking,
  customer,
  hasCleaning,
  isMaintenance,
  isToday,
  isStart,
  isEnd,
  copy,
  bookingLabels,
  onOpenBooking,
  onNewBooking,
}: {
  unit: UnitRow;
  dateStr: string;
  booking: DailyBookingRow | null;
  customer: CustomerSummary | null;
  hasCleaning: boolean;
  isMaintenance: boolean;
  isToday: boolean;
  isStart: boolean;
  isEnd: boolean;
  copy: (typeof COPY)[Locale];
  bookingLabels: Record<string, string>;
  onOpenBooking: (id: string) => void;
  onNewBooking: () => void;
}) {
  const baseCell = cn(
    "group relative h-[68px] border-b border-r border-slate-100 transition-colors",
    isToday ? "bg-violet-50/45" : "bg-white",
  );

  if (isMaintenance) {
    return (
      <div className={baseCell} role="gridcell">
        <div className="absolute inset-x-2 top-1/2 h-9 -translate-y-1/2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700" />
      </div>
    );
  }

  if (booking && booking.status !== "checked_out") {
    const tone = getBookingTone(booking.status);
    const name = customer?.name ?? "?";
    const dateRange = booking.checkout_mode === "open"
      ? `${booking.check_in} → ${copy.openEnded}`
      : `${booking.check_in} → ${booking.check_out ?? copy.openEnded}`;
    return (
      <div className={baseCell} role="gridcell">
        <button
          type="button"
          className={cn(
            "absolute top-1/2 flex h-10 -translate-y-1/2 items-center overflow-hidden px-3 text-left shadow-sm transition-all hover:-translate-y-[54%] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500",
            tone,
            isStart ? "left-2 rounded-l-2xl" : "-left-px rounded-l-none",
            isEnd ? "right-2 rounded-r-2xl" : "-right-px rounded-r-none",
          )}
          title={`${name} · ${dateRange}`}
          onClick={() => onOpenBooking(booking.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onOpenBooking(booking.id);
          }}
        >
          {isStart && (
            <span className="min-w-0">
              <span className="block truncate text-xs font-black leading-4">{name}</span>
              <span className="block truncate text-[10px] font-semibold opacity-80">
                {bookingLabels[booking.status] ?? booking.status}
              </span>
            </span>
          )}
        </button>
      </div>
    );
  }

  if (booking && booking.status === "checked_out") {
    return (
      <div className={baseCell} role="gridcell">
        <button
          type="button"
          className="absolute inset-x-2 top-1/2 h-8 -translate-y-1/2 rounded-xl bg-slate-100 text-[10px] font-bold text-slate-400"
          title={customer?.name ?? copy.booked}
          onClick={() => onOpenBooking(booking.id)}
        >
          {isStart ? customer?.name?.slice(0, 4) ?? "" : ""}
        </button>
      </div>
    );
  }

  if (hasCleaning || unit.status === "cleaning_pending") {
    return (
      <div className={baseCell} role="gridcell">
        <div className="absolute inset-x-2 top-1/2 flex h-9 -translate-y-1/2 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50 text-[11px] font-black text-cyan-700">
          {copy.cleaning}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        baseCell,
        "flex cursor-pointer items-center justify-center hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500",
      )}
      aria-label={`${unit.unit_no} ${dateStr}`}
      onClick={onNewBooking}
      onKeyDown={(event) => {
        if (event.key === "Enter") onNewBooking();
      }}
    >
      <Plus className="hidden h-4 w-4 text-violet-500 group-hover:block group-focus-visible:block" />
    </button>
  );
}

function FloorRow({
  floor,
  count,
  daysCount,
  copy,
}: {
  floor: string;
  count: number;
  daysCount: number;
  copy: (typeof COPY)[Locale];
}) {
  return (
    <>
      <div className="sticky left-0 z-10 flex h-9 items-center border-b border-r border-slate-200 bg-slate-50 px-4 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
        {floor}
      </div>
      <div
        className="flex h-9 items-center border-b border-slate-200 bg-slate-50 px-4 text-[11px] font-bold text-slate-400"
        style={{ gridColumn: `span ${daysCount}` }}
      >
        {copy.floor} · {count}
      </div>
    </>
  );
}

function QuickStat({ label, value, tone }: { label: string; value: number; tone: "sky" | "amber" | "violet" | "cyan" | "emerald" | "slate" }) {
  const styles = {
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    cyan: "border-cyan-200 bg-cyan-50 text-cyan-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];

  return (
    <div className={cn("rounded-2xl border px-4 py-3 shadow-sm", styles)}>
      <p className="text-[11px] font-black uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-slate-950">{value}</p>
    </div>
  );
}

function LegendPill({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm">
      <span className={cn("h-2 w-2 rounded-full", color)} />
      {label}
    </span>
  );
}

function getBookingTone(status: string): string {
  if (status === "checked_in") return "bg-violet-600 text-white shadow-violet-200";
  if (status === "confirmed") return "bg-sky-400 text-white shadow-sky-100";
  if (status === "pending_review") return "bg-slate-900 text-white shadow-slate-200";
  return "bg-slate-100 text-slate-500 shadow-slate-100";
}

function getRoomTone(unit: UnitRow, hasCleaning: boolean, isMaintenance: boolean) {
  if (isMaintenance) return { strip: "bg-rose-400" };
  if (hasCleaning || unit.status === "cleaning_pending") return { strip: "bg-cyan-400" };
  if (unit.status === "reserved") return { strip: "bg-amber-400" };
  if (unit.status === "daily_occupied") return { strip: "bg-violet-500" };
  return { strip: "bg-emerald-400" };
}

function normalizeFloorLabel(floorLabel: string | null, unitNo: string): string {
  if (floorLabel && floorLabel.trim()) return floorLabel.trim().replace("楼", "F");
  const numeric = Number.parseInt(unitNo, 10);
  if (Number.isFinite(numeric)) return `${Math.floor(numeric / 100)}F`;
  return "F";
}

function floorSortValue(label: string): number {
  const match = label.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 999;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}
