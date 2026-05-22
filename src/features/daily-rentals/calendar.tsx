"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Plus, Printer, SlidersHorizontal } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { BookingPanel } from "./booking-panel";
import { buildBookingMap, buildDailyRoomStateMap } from "./room-status";

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

type ViewMode = "day" | "week" | "month";
type RoomFilter = "all" | "available" | "occupied" | "checkingOutToday" | "openEnded" | "reserved" | "cleaning" | "maintenance";

const ROOM_COL_WIDTH = 136;
const DAY_COL_MIN_WIDTH = 72;
const DAY_COL_WIDTH = 78;
const ROW_HEIGHT = 60;
const FLOOR_ROW_HEIGHT = 20;
const MAINTENANCE_STATUSES = new Set(["available", "reserved", "daily_occupied", "cleaning_pending"]);

const NAV_BTN =
  "inline-flex h-8 w-8 items-center justify-center rounded-xl border border-brand-warm-300 bg-white text-brand-ink-500 shadow-sm transition-all duration-fast hover:border-brand-orange-200 hover:bg-brand-orange-50 hover:text-brand-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange-500";

const COPY = {
  zh: {
    noRooms: "暂无日租房源",
    timeline: "预订时间轴",
    subtitle: "默认显示今天附近日期；点击空白格新建预订，点击色条查看订单。",
    roomType: "房间 / 状态",
    allRooms: "全部房间",
    day: "天",
    week: "周",
    month: "月",
    today: "今天",
    occupied: "入住",
    maintenance: "维修",
    available: "可预订",
    reserved: "预订",
    cleaning: "待保洁",
    openEnded: "未定离店",
    room: "房间",
    floor: "楼",
    apartment: "公寓",
    emptyFilter: "当前筛选下没有房间",
  },
  fr: {
    noRooms: "Aucune chambre journaliere",
    timeline: "Planning des reservations",
    subtitle: "Affiche les dates autour d'aujourd'hui. Cliquez une case vide pour creer.",
    roomType: "Chambre / statut",
    allRooms: "Toutes",
    day: "Jour",
    week: "Semaine",
    month: "Mois",
    today: "Aujourd'hui",
    occupied: "Occupe",
    maintenance: "Maintenance",
    available: "Disponible",
    reserved: "Reserve",
    cleaning: "Menage",
    openEnded: "Ouvert",
    room: "Chambre",
    floor: "Etage",
    apartment: "Appartement",
    emptyFilter: "Aucune chambre dans ce filtre",
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [roomFilter, setRoomFilter] = useState<RoomFilter>("all");
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [newBookingUnitId, setNewBookingUnitId] = useState<string | null>(null);
  const [newBookingDate, setNewBookingDate] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [optimisticBookings, setOptimisticBookings] = useState<DailyBookingRow[]>([]);

  const bookings = useMemo(() => {
    const seen = new Set(optimisticBookings.map((booking) => booking.id));
    return [...optimisticBookings, ...serverBookings.filter((booking) => !seen.has(booking.id))];
  }, [serverBookings, optimisticBookings]);

  const localeStr = locale === "fr" ? "fr-FR" : "zh-CN";
  const todayStr = toDateStr(new Date());
  const tomorrowStr = toDateStr(new Date(Date.now() + 86400000));

  const { visibleDays, visibleEndExclusiveStr, rangeLabel } = useMemo(() => {
    const start = resolveRangeStart(anchorDate, viewMode);
    const end = resolveRangeEnd(anchorDate, viewMode);
    const days: Date[] = [];
    const cursor = new Date(start);
    while (cursor < end) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      visibleDays: days,
      visibleEndExclusiveStr: toDateStr(end),
      rangeLabel: formatRangeLabel(days, localeStr, viewMode),
    };
  }, [anchorDate, localeStr, viewMode]);

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

  const todayStateMap = useMemo(
    () => buildDailyRoomStateMap({ dailyUnits, dateStr: todayStr, bookings, cleaningTasks }),
    [dailyUnits, todayStr, bookings, cleaningTasks],
  );

  const filterCounts = useMemo(() => {
    const counts: Record<RoomFilter, number> = {
      all: dailyUnits.length,
      available: 0,
      occupied: 0,
      checkingOutToday: 0,
      openEnded: 0,
      reserved: 0,
      cleaning: 0,
      maintenance: 0,
    };
    for (const unit of dailyUnits) {
      const state = todayStateMap.get(unit.id);
      if (!state) continue;
      switch (state.status) {
        case "available": counts.available++; break;
        case "occupied": counts.occupied++; break;
        case "checking_out_today": counts.checkingOutToday++; counts.occupied++; break;
        case "reserved": counts.reserved++; break;
        case "cleaning": counts.cleaning++; break;
        case "maintenance":
        case "locked": counts.maintenance++; break;
      }
      if (state.booking?.checkout_mode === "open" && (state.status === "occupied" || state.status === "checking_out_today")) {
        counts.openEnded++;
      }
    }
    return counts;
  }, [dailyUnits, todayStateMap]);

  const filteredUnits = useMemo(() => {
    return dailyUnits.filter((unit) => {
      if (roomFilter === "all") return true;
      const status = getUnitTimelineStatus(unit, visibleDays, bookingMap, unitCleaningMap, todayStr);
      if (roomFilter === "occupied") return status === "occupied" || status === "checkingOutToday" || status === "openEnded";
      return status === roomFilter;
    });
  }, [bookingMap, dailyUnits, roomFilter, unitCleaningMap, visibleDays, todayStr]);

  const unitsByFloor = useMemo(() => {
    const grouped = new Map<string, UnitRow[]>();
    for (const unit of filteredUnits) {
      const floor = normalizeFloorLabel(unit.floor_label, unit.unit_no);
      if (!grouped.has(floor)) grouped.set(floor, []);
      grouped.get(floor)!.push(unit);
    }
    return Array.from(grouped.entries()).sort((a, b) => floorSortValue(a[0]) - floorSortValue(b[0]));
  }, [filteredUnits]);

  const [copied, setCopied] = useState(false);

  const shareRows = useMemo(() => {
    const occupied = dailyUnits.filter((u) => {
      const s = todayStateMap.get(u.id);
      return s && (s.status === "occupied" || s.status === "checking_out_today" || s.status === "reserved");
    });
    const checkingOut = dailyUnits.filter((u) => {
      const s = todayStateMap.get(u.id);
      return s?.isCheckoutDay;
    });
    const cleaning = dailyUnits.filter((u) => {
      const s = todayStateMap.get(u.id);
      return s?.status === "cleaning";
    });
    const available = dailyUnits.filter((u) => {
      const s = todayStateMap.get(u.id);
      return s?.status === "available";
    });
    return [
      { key: "occupied", label: locale === "zh" ? "占用" : "Occupe", count: occupied.length, units: occupied.map((u) => u.unit_no), tone: "dark" as const },
      { key: "checkout", label: locale === "zh" ? "今日离店" : "Depart", count: checkingOut.length, units: checkingOut.map((u) => u.unit_no), tone: "orange" as const },
      { key: "cleaning", label: locale === "zh" ? "待保洁" : "Menage", count: cleaning.length, units: cleaning.map((u) => u.unit_no), tone: "teal" as const },
      { key: "available", label: locale === "zh" ? "可安排入住" : "Disponible", count: available.length, units: available.map((u) => u.unit_no), tone: "green" as const },
    ];
  }, [dailyUnits, todayStateMap, locale]);

  const handleCopy = useCallback(async () => {
    let text = `11# ${locale === "zh" ? "日租房态" : "Occupation journaliere"}\n`;
    for (const row of shareRows) {
      text += `\n${row.label}: ${row.count}\n`;
      text += `${row.units.join(", ")}\n`;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareRows, locale]);

  const panelBooking = selectedBookingId ? bookings.find((booking) => booking.id === selectedBookingId) ?? null : null;

  useEffect(() => {
    const todayIndex = visibleDays.findIndex((date) => toDateStr(date) === todayStr);
    if (todayIndex < 0 || !scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, (todayIndex - 1) * DAY_COL_WIDTH);
  }, [todayStr, visibleDays, viewMode]);

  const moveRange = useCallback((direction: -1 | 1) => {
    setAnchorDate((prev) => {
      if (viewMode === "month") return new Date(prev.getFullYear(), prev.getMonth() + direction, 1);
      if (viewMode === "week") return addDays(prev, direction * 7);
      return addDays(prev, direction * 7);
    });
  }, [viewMode]);

  const goToToday = useCallback(() => {
    setAnchorDate(new Date());
  }, []);

  const setMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setAnchorDate((prev) => mode === "month" ? new Date(prev.getFullYear(), prev.getMonth(), 1) : prev);
  }, []);

  if (dailyUnits.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[22px] border border-brand-warm-300 bg-white py-12 text-center shadow-sm">
        <p className="text-sm text-brand-ink-500">{copy.noRooms}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-natural">
        <div className="flex flex-col gap-4 border-b border-neutral-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-base font-black leading-5 text-brand-neutral-950">{locale === "zh" ? "今日可发群内容" : "Message du jour"}</h3>
            <p className="mt-1 text-sm font-semibold text-brand-neutral-700">
              {locale === "zh" ? "房态摘要已按群发格式整理，可直接复制。" : "Resume pret a copier."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-2xl border border-neutral-200 bg-brand-neutral-50 px-4 py-2 text-sm font-black text-brand-neutral-950">
              {new Date(todayStr).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN")}
              <span className="ml-3 text-brand-neutral-500">
                {new Date(todayStr).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { weekday: "long" })}
              </span>
            </div>
            <Button variant="primary" size="sm" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? (locale === "zh" ? "已复制" : "Copie") : (locale === "zh" ? "复制群消息" : "Copier")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()} className="no-print">
              <Printer className="h-3.5 w-3.5" />
              {locale === "zh" ? "打印" : "Imprimer"}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 bg-brand-neutral-50/70 px-5 py-4 md:grid-cols-2 xl:grid-cols-4">
          {shareRows.map((row) => (
            <ShareCard key={row.key} label={row.label} value={row.count} units={row.units} tone={row.tone} />
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-brand-warm-300 bg-white shadow-[0_18px_56px_rgba(88,65,43,0.08)]">
        <div className="flex flex-col gap-3 border-b border-brand-warm-300 bg-brand-warm-50 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-black tracking-tight text-brand-ink-900">{copy.timeline}</h2>
            <p className="mt-0.5 text-[13px] font-medium text-brand-ink-500">{copy.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterButton
              active={roomFilter === "all"}
              onClick={() => setRoomFilter("all")}
              icon={<SlidersHorizontal className="h-4 w-4" />}
              label={copy.allRooms}
              count={filterCounts.all}
            />
            <FilterButton active={roomFilter === "occupied"} onClick={() => setRoomFilter("occupied")} color="bg-brand-orange-500" label={copy.occupied} count={filterCounts.occupied} />
            <FilterButton active={roomFilter === "checkingOutToday"} onClick={() => setRoomFilter("checkingOutToday")} color="bg-brand-orange-300" label={locale === "zh" ? "今日离店" : "Depart"} count={filterCounts.checkingOutToday} />
            <FilterButton active={roomFilter === "openEnded"} onClick={() => setRoomFilter("openEnded")} color="bg-brand-orange-400" label={locale === "zh" ? "未定离店" : "Ouvert"} count={filterCounts.openEnded} />
            <FilterButton active={roomFilter === "reserved"} onClick={() => setRoomFilter("reserved")} color="bg-brand-amber-500" label={copy.reserved} count={filterCounts.reserved} />
            <FilterButton active={roomFilter === "cleaning"} onClick={() => setRoomFilter("cleaning")} color="bg-brand-blue-500" label={copy.cleaning} count={filterCounts.cleaning} />
            <FilterButton active={roomFilter === "available"} onClick={() => setRoomFilter("available")} color="bg-brand-green-500" label={copy.available} count={filterCounts.available} />
            <FilterButton active={roomFilter === "maintenance"} onClick={() => setRoomFilter("maintenance")} color="bg-brand-red-500" label={copy.maintenance} count={filterCounts.maintenance} />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-brand-warm-300 bg-white px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit rounded-xl border border-brand-warm-300 bg-brand-warm-100 p-1 text-xs font-bold text-brand-ink-500">
            <ViewButton active={viewMode === "day"} onClick={() => setMode("day")}>{copy.day}</ViewButton>
            <ViewButton active={viewMode === "week"} onClick={() => setMode("week")}>{copy.week}</ViewButton>
            <ViewButton active={viewMode === "month"} onClick={() => setMode("month")}>{copy.month}</ViewButton>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => moveRange(-1)} className={NAV_BTN} aria-label="previous range">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-[190px] rounded-xl bg-brand-warm-100 px-4 py-1.5 text-center text-sm font-black text-brand-ink-900">
              {rangeLabel}
            </div>
            <button onClick={() => moveRange(1)} className={NAV_BTN} aria-label="next range">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={goToToday}
              className="h-8 rounded-xl bg-brand-orange-500 px-4 text-sm font-black text-white shadow-lg shadow-brand-orange-100 transition hover:bg-brand-orange-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange-500"
            >
              {copy.today}
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="scroll-hint-x overflow-auto bg-white" style={{ maxHeight: "calc(100vh - 178px)" }} data-scroll-x>
          <div
            className="grid min-w-full"
            style={{ gridTemplateColumns: `${ROOM_COL_WIDTH}px repeat(${visibleDays.length}, minmax(${DAY_COL_MIN_WIDTH}px, 1fr))` }}
            role="grid"
            aria-label={copy.timeline}
          >
            <div
              className="sticky left-0 top-0 z-30 flex items-center border-b border-r border-brand-warm-300 bg-white px-3 text-[10px] font-black uppercase tracking-[0.12em] text-brand-ink-500"
              style={{ height: 38 }}
            >
              {copy.roomType}
            </div>
            {visibleDays.map((date) => {
              const dateStr = toDateStr(date);
              const isToday = dateStr === todayStr;
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <div
                  key={dateStr}
                  className={cn(
                    "sticky top-0 z-20 flex flex-col items-center justify-center border-b border-r border-brand-warm-300 text-xs",
                    isToday && "bg-brand-orange-50 text-brand-orange-700",
                    isWeekend && !isToday && "bg-brand-warm-50 text-brand-ink-400",
                    !isToday && !isWeekend && "bg-white text-brand-ink-500",
                  )}
                  style={{ height: 38 }}
                  role="columnheader"
                >
                  <span className="font-semibold">{date.toLocaleDateString(localeStr, { weekday: "short" })}</span>
                  <span className="text-sm font-black text-brand-ink-900">{date.getDate()}</span>
                  {isToday && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-brand-orange-500" />}
                </div>
              );
            })}

            {unitsByFloor.length === 0 ? (
              <div
                className="flex h-24 items-center justify-center text-sm font-semibold text-brand-ink-400"
                style={{ gridColumn: `span ${visibleDays.length + 1}` }}
              >
                {copy.emptyFilter}
              </div>
            ) : (
              unitsByFloor.flatMap(([floor, units]) => [
                <FloorRow key={`floor-${floor}`} floor={floor} count={units.length} daysCount={visibleDays.length} copy={copy} />,
                ...units.flatMap((unit) => {
                  const unitBM = bookingMap.get(unit.id);
                  const hasCleaning = unitCleaningMap.get(unit.id) === true;
                  const isMaintenance = !MAINTENANCE_STATUSES.has(unit.status);
                  const roomTone = getRoomTone(unit, hasCleaning, isMaintenance);
                  const statusLabel = isMaintenance
                    ? statusLabels[unit.status as UnitStatus]
                    : hasCleaning || unit.status === "cleaning_pending"
                      ? copy.cleaning
                      : statusLabels[unit.status as UnitStatus] ?? copy.available;

                  return [
                    <div
                      key={`${unit.id}-room`}
                      className="sticky left-0 z-10 flex items-center border-b border-r border-brand-warm-200 bg-white px-3"
                      style={{ height: ROW_HEIGHT }}
                      role="rowheader"
                    >
                      <span className={cn("mr-2 h-10 w-1.5 rounded-full", roomTone.strip)} />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-black leading-3 text-brand-ink-900">{copy.room} {unit.unit_no}</div>
                        <div className="truncate text-[9px] font-semibold leading-3 text-brand-ink-500">
                          {statusLabel} · {copy.apartment}
                        </div>
                      </div>
                    </div>,
                    ...visibleDays.map((date) => {
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
              ])
            )}
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
    "group relative border-b border-r border-brand-warm-100 transition-colors",
    isToday ? "bg-brand-orange-50/45" : "bg-white",
  );

  if (isMaintenance) {
    return (
      <div className={baseCell} style={{ height: ROW_HEIGHT }} role="gridcell">
        <div className="absolute inset-x-1.5 top-1/2 h-9 -translate-y-1/2 rounded-lg border border-brand-red-200 bg-brand-red-50" />
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
      <div className={baseCell} style={{ height: ROW_HEIGHT }} role="gridcell">
        <button
          type="button"
          className={cn(
            "absolute top-1/2 flex h-10 -translate-y-1/2 items-center overflow-hidden px-2 text-left shadow-sm transition-all hover:-translate-y-[54%] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange-500",
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
              <span className="block truncate text-[10px] font-black leading-3">{name}</span>
              <span className="block truncate text-[8px] font-semibold opacity-85">
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
      <div className={baseCell} style={{ height: ROW_HEIGHT }} role="gridcell">
        <button
          type="button"
          className="absolute inset-x-1.5 top-1/2 h-9 -translate-y-1/2 rounded-lg bg-brand-warm-100 text-[9px] font-bold text-brand-ink-400"
          title={customer?.name ?? copy.occupied}
          onClick={() => onOpenBooking(booking.id)}
        >
          {isStart ? customer?.name?.slice(0, 4) ?? "" : ""}
        </button>
      </div>
    );
  }

  if (hasCleaning || unit.status === "cleaning_pending") {
    return (
      <div className={baseCell} style={{ height: ROW_HEIGHT }} role="gridcell">
        <div className="absolute inset-x-1.5 top-1/2 flex h-9 -translate-y-1/2 items-center justify-center rounded-lg border border-brand-blue-200 bg-brand-blue-50 text-[9px] font-black text-brand-blue-700">
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
        "flex cursor-pointer items-center justify-center hover:bg-brand-orange-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand-orange-500",
      )}
      style={{ height: ROW_HEIGHT }}
      aria-label={`${unit.unit_no} ${dateStr}`}
      onClick={onNewBooking}
      onKeyDown={(event) => {
        if (event.key === "Enter") onNewBooking();
      }}
    >
      <Plus className="hidden h-4 w-4 text-brand-orange-500 group-hover:block group-focus-visible:block" />
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
      <div
        className="sticky left-0 z-10 flex items-center border-b border-r border-brand-warm-200 bg-brand-warm-50 px-3 text-[10px] font-black uppercase tracking-[0.12em] text-brand-ink-500"
        style={{ height: FLOOR_ROW_HEIGHT }}
      >
        {floor}
      </div>
      <div
        className="flex items-center border-b border-brand-warm-200 bg-brand-warm-50 px-3 text-[10px] font-bold text-brand-ink-400"
        style={{ gridColumn: `span ${daysCount}`, height: FLOOR_ROW_HEIGHT }}
      >
        {copy.floor} · {count}
      </div>
    </>
  );
}

type ShareTone = "dark" | "orange" | "teal" | "green";

function ShareCard({ label, value, units, tone }: { label: string; value: number; units: string[]; tone: ShareTone }) {
  const styles = {
    dark: "border-brand-orange-200 bg-brand-orange-50 text-brand-orange-900",
    orange: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
    teal: "border-brand-blue-200 bg-brand-blue-50 text-brand-blue-900",
    green: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
  }[tone];
  return (
    <div className={cn("rounded-2xl border px-4 py-3 shadow-sm", styles)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-black opacity-85">{label}</p>
        <p className="text-2xl font-black tabular-nums leading-none">{value}</p>
      </div>
      <p className="mt-3 min-h-6 text-sm font-black leading-6">{units.join(", ")}</p>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  count,
  color,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-black shadow-sm transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange-500",
        active ? "border-brand-orange-500 bg-brand-orange-500 text-white" : "border-brand-warm-300 bg-white text-brand-ink-700 hover:border-brand-orange-200 hover:bg-brand-orange-50",
      )}
    >
      {icon ?? <span className={cn("h-2 w-2 rounded-full", color)} />}
      <span>{label}</span>
      <span className={cn("tabular-nums", active ? "text-white/85" : "text-brand-ink-400")}>{count}</span>
    </button>
  );
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 transition",
        active ? "bg-white text-brand-orange-700 shadow-sm" : "text-brand-ink-500 hover:text-brand-ink-900",
      )}
    >
      {children}
    </button>
  );
}

function getBookingTone(status: string): string {
  if (status === "checked_in") return "bg-brand-orange-500 text-white shadow-brand-orange-100";
  if (status === "confirmed") return "bg-brand-amber-200 text-brand-amber-900 ring-1 ring-inset ring-brand-amber-300 shadow-brand-amber-100";
  if (status === "pending_review") return "bg-brand-blue-500 text-white shadow-brand-blue-100";
  return "bg-brand-warm-100 text-brand-ink-500 shadow-brand-warm-200";
}

function getRoomTone(unit: UnitRow, hasCleaning: boolean, isMaintenance: boolean) {
  if (isMaintenance) return { strip: "bg-brand-red-500" };
  if (hasCleaning || unit.status === "cleaning_pending") return { strip: "bg-brand-blue-500" };
  if (unit.status === "reserved") return { strip: "bg-brand-amber-500" };
  if (unit.status === "daily_occupied") return { strip: "bg-brand-orange-500" };
  return { strip: "bg-brand-green-500" };
}

function getUnitTimelineStatus(
  unit: UnitRow,
  visibleDays: Date[],
  bookingMap: Map<string, Map<string, DailyBookingRow>>,
  unitCleaningMap: Map<string, boolean>,
  todayStr?: string,
): Exclude<RoomFilter, "all"> {
  if (!MAINTENANCE_STATUSES.has(unit.status)) return "maintenance";
  if (unitCleaningMap.get(unit.id) === true || unit.status === "cleaning_pending") return "cleaning";

  const unitBookings = bookingMap.get(unit.id);
  if (unitBookings) {
    for (const date of visibleDays) {
      const booking = unitBookings.get(toDateStr(date));
      if (!booking || booking.status === "checked_out") continue;
      if (booking.status === "checked_in") {
        if (booking.checkout_mode === "open") return "openEnded";
        if (todayStr && booking.check_out === todayStr) return "checkingOutToday";
        return "occupied";
      }
      if (booking.status === "confirmed" || booking.status === "pending_review") return "reserved";
    }
  }

  if (unit.status === "daily_occupied") return "occupied";
  if (unit.status === "reserved") return "reserved";
  return "available";
}

function resolveRangeStart(anchorDate: Date, viewMode: ViewMode): Date {
  const anchor = startOfDay(anchorDate);
  if (viewMode === "month") return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  if (viewMode === "week") return startOfWeek(anchor);
  return addDays(anchor, -1);
}

function resolveRangeEnd(anchorDate: Date, viewMode: ViewMode): Date {
  const start = resolveRangeStart(anchorDate, viewMode);
  if (viewMode === "month") return new Date(start.getFullYear(), start.getMonth() + 1, 1);
  if (viewMode === "week") return addDays(start, 7);
  return addDays(start, 10);
}

function formatRangeLabel(days: Date[], localeStr: string, viewMode: ViewMode): string {
  if (days.length === 0) return "";
  if (viewMode === "month") {
    return days[0].toLocaleDateString(localeStr, { year: "numeric", month: "long" });
  }
  const first = days[0];
  const last = days[days.length - 1];
  const firstText = first.toLocaleDateString(localeStr, { month: "short", day: "numeric" });
  const lastText = last.toLocaleDateString(localeStr, { month: "short", day: "numeric" });
  return `${first.getFullYear()} ${firstText} - ${lastText}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  const day = start.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(start, offset);
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
