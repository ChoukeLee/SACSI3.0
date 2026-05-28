"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Plus, Printer, SlidersHorizontal, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn, formatXof, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { BookingPanel } from "./booking-panel";
import { completeCleaning } from "./actions";
import { ConfirmDialog } from "@/features/mobile/confirm-dialog";
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

const ROOM_COL_WIDTH = 128;
const DAY_COL_MIN_WIDTH = 70;
const DAY_COL_WIDTH = 74;
const ROW_HEIGHT = 46;
const FLOOR_ROW_HEIGHT = 18;
const MAINTENANCE_STATUSES = new Set(["available", "reserved", "daily_occupied", "cleaning_pending", "leased", "sold"]);

const NAV_BTN =
  "inline-flex h-8 w-8 items-center justify-center rounded-xl border border-brand-warm-300 bg-white text-brand-ink-500 shadow-sm transition-all duration-fast hover:border-brand-indigo-200 hover:bg-brand-indigo-50 hover:text-brand-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo-500";

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
  const [cleaningTarget, setCleaningTarget] = useState<{ taskId: string; unitNo: string } | null>(null);
  const [cleaningLoading, setCleaningLoading] = useState(false);

  const bookings = useMemo(() => {
    const seen = new Set(optimisticBookings.map((booking) => booking.id));
    return [...optimisticBookings, ...serverBookings.filter((booking) => !seen.has(booking.id))];
  }, [serverBookings, optimisticBookings]);

  const localeStr = locale === "fr" ? "fr-FR" : "zh-CN";
  const todayStr = toDateStr(new Date());
  const tomorrowStr = toDateStr(new Date(Date.now() + 86400000));

  const { visibleDays, rangeLabel } = useMemo(() => {
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
      rangeLabel: formatRangeLabel(days, localeStr, viewMode),
    };
  }, [anchorDate, localeStr, viewMode]);

  const bookingMap = useMemo(
    () => buildBookingMap(bookings, { todayStr, tomorrowStr }),
    [bookings, todayStr, tomorrowStr],
  );

  const customerMap = useMemo(() => {
    const map = new Map<string, CustomerSummary>();
    for (const customer of customers) map.set(customer.id, customer);
    return map;
  }, [customers]);

  const unitCleaningMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of cleaningTasks) {
      if (!task.is_completed) map.set(task.unit_id, task.id);
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
      counts[getUnitTimelineStatus(unit, visibleDays, bookingMap, unitCleaningMap, todayStr)]++;
    }
    counts.occupied += counts.checkingOutToday + counts.openEnded;
    return counts;
  }, [dailyUnits, visibleDays, bookingMap, unitCleaningMap, todayStr]);

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
  const [financeDetail, setFinanceDetail] = useState<"collected" | "outstanding" | "settled" | null>(null);

  const financeStats = useMemo(() => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    let monthCollected = 0;
    let currentOutstanding = 0;
    let monthSettled = 0;
    const collectedPayments: typeof payments = [];
    const outstandingBookings: DailyBookingRow[] = [];
    const settledBookings: DailyBookingRow[] = [];

    for (const p of payments) {
      if (p.payment_date.startsWith(currentMonth)) {
        monthCollected += Number(p.amount);
        collectedPayments.push(p);
      }
    }

    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      const final = Number(b.final_amount_xof ?? b.total_amount_xof);
      const prepaid = Number(b.prepaid_amount_xof ?? 0);
      const outstanding = final - prepaid;

      if (outstanding > 0 && (b.status === "checked_in" || b.status === "checked_out")) {
        currentOutstanding += outstanding;
        outstandingBookings.push(b);
      }

      const settledDate = b.checkout_mode === "open" ? b.actual_check_out : b.check_out;
      if (b.status === "checked_out" && settledDate && settledDate.startsWith(currentMonth)) {
        monthSettled += final;
        settledBookings.push(b);
      }
    }

    return {
      monthCollected, currentOutstanding, monthSettled,
      collectedPayments, outstandingBookings, settledBookings,
    };
  }, [bookings, payments]);

  const financeCards = useMemo(() => [
    { key: "collected", label: locale === "zh" ? "本月已收" : "Encaisse", value: formatXof(financeStats.monthCollected), tone: "green" as const },
    { key: "outstanding", label: locale === "zh" ? "当前欠款" : "Impaye", value: formatXof(financeStats.currentOutstanding), tone: "orange" as const },
    { key: "settled", label: locale === "zh" ? "本月结算" : "Regle", value: formatXof(financeStats.monthSettled), tone: "dark" as const },
  ], [financeStats, locale]);

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
      return addDays(prev, direction * 7);
    });
  }, [viewMode]);

  const goToToday = useCallback(() => {
    setAnchorDate(new Date());
  }, []);

  const setMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setAnchorDate((prev) => {
      if (mode === "month") return new Date(prev.getFullYear(), prev.getMonth(), 1);
      return new Date();
    });
  }, []);

  if (dailyUnits.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-brand-warm-300 bg-white py-12 text-center shadow-sm">
        <p className="text-sm text-brand-ink-500">{copy.noRooms}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-brand-warm-300 bg-white shadow-card">
        <div className="flex flex-col gap-3 border-b border-brand-warm-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-base font-black leading-5 text-brand-neutral-950">{locale === "zh" ? "日租概览" : "Apercu journalier"}</h3>
            <p className="mt-1 text-sm font-semibold text-brand-neutral-700">
              {locale === "zh" ? "房态与财务摘要，点击财务卡片查看明细。" : "Statut et finances, cliquez pour les details."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-brand-warm-200 bg-brand-neutral-50 px-3 py-1.5 text-xs font-black text-brand-neutral-950">
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
        <div className="grid gap-2 bg-brand-neutral-50/70 px-4 py-3 md:grid-cols-2 xl:grid-cols-4">
          {shareRows.map((row) => (
            <ShareCard key={row.key} label={row.label} value={row.count} units={row.units} tone={row.tone} />
          ))}
        </div>
        <div className="border-t border-brand-warm-200 bg-brand-neutral-50/70 px-4 py-3">
          <p className="mb-2.5 text-xs font-black uppercase tracking-[0.14em] text-brand-ink-400">{locale === "zh" ? "本月财务" : "Finances du mois"}</p>
          <div className="grid gap-2 md:grid-cols-3">
            {financeCards.map((card) => (
              <FinanceCard key={card.key} label={card.label} value={card.value} tone={card.tone} onClick={() => setFinanceDetail(card.key as "collected" | "outstanding" | "settled")} />
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-brand-warm-300 bg-white shadow-card">
        <div className="flex flex-col gap-3 border-b border-brand-warm-300 bg-white px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-black tracking-tight text-brand-ink-900">{copy.timeline}</h2>
            <p className="mt-0.5 text-xs font-semibold text-brand-ink-500">{copy.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterButton
              active={roomFilter === "all"}
              onClick={() => setRoomFilter("all")}
              icon={<SlidersHorizontal className="h-4 w-4" />}
              label={copy.allRooms}
              count={filterCounts.all}
            />
            <FilterButton active={roomFilter === "occupied"} onClick={() => setRoomFilter("occupied")} color="bg-brand-indigo-500" label={copy.occupied} count={filterCounts.occupied} />
            <FilterButton active={roomFilter === "checkingOutToday"} onClick={() => setRoomFilter("checkingOutToday")} color="bg-brand-indigo-300" label={locale === "zh" ? "今日离店" : "Depart"} count={filterCounts.checkingOutToday} />
            <FilterButton active={roomFilter === "openEnded"} onClick={() => setRoomFilter("openEnded")} color="bg-brand-indigo-400" label={locale === "zh" ? "未定离店" : "Ouvert"} count={filterCounts.openEnded} />
            <FilterButton active={roomFilter === "reserved"} onClick={() => setRoomFilter("reserved")} color="bg-brand-amber-500" label={copy.reserved} count={filterCounts.reserved} />
            <FilterButton active={roomFilter === "cleaning"} onClick={() => setRoomFilter("cleaning")} color="bg-brand-green-500" label={copy.cleaning} count={filterCounts.cleaning} />
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
              className="h-8 rounded-xl bg-brand-indigo-500 px-4 text-sm font-black text-white shadow-lifted transition hover:bg-brand-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo-500"
            >
              {copy.today}
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="scroll-hint-x overflow-auto bg-white" style={{ maxHeight: "calc(100vh - 220px)" }} data-scroll-x>
          <div
            className="grid w-full min-w-full"
            style={{ gridTemplateColumns: `${ROOM_COL_WIDTH}px repeat(${visibleDays.length}, minmax(${DAY_COL_MIN_WIDTH}px, 1fr))`, minWidth: "100%" }}
            role="grid"
            aria-label={copy.timeline}
          >
            <div
              className="sticky left-0 top-0 z-30 flex items-center border-b border-r border-brand-warm-300 bg-white px-3 text-xs font-black uppercase tracking-[0.12em] text-brand-ink-500"
              style={{ height: 40 }}
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
                    isToday && "bg-brand-indigo-50 text-brand-indigo-700",
                    isWeekend && !isToday && "bg-brand-warm-50 text-brand-ink-400",
                    !isToday && !isWeekend && "bg-white text-brand-ink-500",
                  )}
                  style={{ height: 40 }}
                  role="columnheader"
                >
                  <span className="text-xs font-semibold leading-3">{date.toLocaleDateString(localeStr, { weekday: "short" })}</span>
                  <span className="text-base font-black leading-5 text-brand-ink-900">{date.getDate()}</span>
                  {isToday && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-brand-indigo-500" />}
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
                  const hasCleaning = unitCleaningMap.has(unit.id);
                  const cleaningTaskId = unitCleaningMap.get(unit.id);
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
                      <span className={cn("mr-2 h-8 w-1.5 rounded-full", roomTone.strip)} />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black leading-4 text-brand-ink-900">{copy.room} {unit.unit_no}</div>
                        <div className="truncate text-xs font-semibold leading-3 text-brand-ink-500">
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
                          onCompleteCleaning={() => {
                            if (cleaningTaskId) {
                              setCleaningTarget({ taskId: cleaningTaskId, unitNo: unit.unit_no });
                            }
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
            setOptimisticBookings([]);
          }}
          onChanged={() => { setTick((t) => t + 1); setOptimisticBookings([]); }}
          onBookingCreated={(booking) => setOptimisticBookings((prev) => [booking, ...prev])}
        />
      )}

      <ConfirmDialog
        open={cleaningTarget !== null}
        onClose={() => setCleaningTarget(null)}
        onConfirm={() => {
          if (!cleaningTarget) return;
          setCleaningLoading(true);
          completeCleaning(cleaningTarget.taskId).then(() => {
            setCleaningLoading(false);
            setCleaningTarget(null);
            setTick((t) => t + 1);
          });
        }}
        title={locale === "zh" ? "完成保洁" : "Menage termine"}
        description={cleaningTarget
          ? (locale === "zh" ? `确认 ${cleaningTarget.unitNo} 保洁已完成？` : `Confirmer le menage de ${cleaningTarget.unitNo} ?`)
          : ""}
        confirmLabel={locale === "zh" ? "完成保洁" : "Terminer"}
        locale={locale}
        loading={cleaningLoading}
      />

      {/* Finance detail panel */}
      {financeDetail && (
        <>
          <div className="fixed inset-0 z-overlay bg-black/30 backdrop-blur-sm" onClick={() => setFinanceDetail(null)} />
          <div className="fixed inset-y-0 right-0 z-panel w-full max-w-full overflow-auto border-l border-brand-warm-200 bg-white shadow-panel lg:max-w-lg" role="dialog">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-warm-200 bg-white/95 px-5 py-4 backdrop-blur">
              <div>
                <h3 className="text-sm font-black text-brand-ink-900">
                  {financeDetail === "collected" ? (locale === "zh" ? "本月已收明细" : "Paiements du mois") :
                   financeDetail === "outstanding" ? (locale === "zh" ? "当前欠款明细" : "Soldes impayes") :
                   (locale === "zh" ? "本月结算明细" : "Reglements du mois")}
                </h3>
              </div>
              <button onClick={() => setFinanceDetail(null)} className="rounded-full p-1.5 text-brand-ink-400 hover:bg-brand-warm-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* Summary */}
              <div className="flex flex-wrap gap-4 rounded-xl bg-brand-warm-50 px-4 py-3 text-sm">
                {financeDetail === "collected" && (
                  <>
                    <div><span className="text-brand-ink-500">{locale === "zh" ? "笔数" : "Nb"}: </span><span className="font-black">{financeStats.collectedPayments.length}</span></div>
                    <div><span className="text-brand-ink-500">{locale === "zh" ? "合计" : "Total"}: </span><span className="font-black text-brand-green-700">{formatXof(financeStats.monthCollected)}</span></div>
                  </>
                )}
                {financeDetail === "outstanding" && (
                  <>
                    <div><span className="text-brand-ink-500">{locale === "zh" ? "欠款笔数" : "Nb"}: </span><span className="font-black">{financeStats.outstandingBookings.length}</span></div>
                    <div><span className="text-brand-ink-500">{locale === "zh" ? "欠款合计" : "Total"}: </span><span className="font-black text-brand-indigo-700">{formatXof(financeStats.currentOutstanding)}</span></div>
                  </>
                )}
                {financeDetail === "settled" && (
                  <>
                    <div><span className="text-brand-ink-500">{locale === "zh" ? "笔数" : "Nb"}: </span><span className="font-black">{financeStats.settledBookings.length}</span></div>
                    <div><span className="text-brand-ink-500">{locale === "zh" ? "合计" : "Total"}: </span><span className="font-black text-brand-ink-900">{formatXof(financeStats.monthSettled)}</span></div>
                  </>
                )}
              </div>

              {/* Table */}
              <div className="overflow-hidden rounded-xl border border-brand-warm-200">
                <div className="max-h-[calc(100vh-260px)] overflow-auto">
                  {financeDetail === "collected" && (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10 bg-brand-warm-50">
                        <tr className="text-left text-xs font-black uppercase tracking-[0.12em] text-brand-ink-500">
                          <th className="px-4 py-3">{locale === "zh" ? "日期" : "Date"}</th>
                          <th className="px-4 py-3">{locale === "zh" ? "房号" : "Chambre"}</th>
                          <th className="px-4 py-3">{locale === "zh" ? "客户" : "Client"}</th>
                          <th className="px-4 py-3 text-right">{locale === "zh" ? "金额" : "Montant"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-warm-100">
                        {financeStats.collectedPayments.length === 0 ? (
                          <tr><td colSpan={4} className="px-4 py-10 text-center text-brand-ink-400">{locale === "zh" ? "本月暂无收款" : "Aucun paiement ce mois"}</td></tr>
                        ) : (
                          [...financeStats.collectedPayments].sort((a, b) => b.payment_date.localeCompare(a.payment_date)).map(p => {
                            const b = bookings.find(bk => bk.id === p.source_id);
                            const u = dailyUnits.find(u => u.id === b?.unit_id);
                            const c = b ? customerMap.get(b.customer_id) : null;
                            return (
                              <tr key={p.id} className="hover:bg-brand-warm-50">
                                <td className="px-4 py-2.5 font-medium text-brand-ink-900">{p.payment_date}</td>
                                <td className="px-4 py-2.5 text-brand-ink-700">{u?.unit_no ?? "—"}</td>
                                <td className="px-4 py-2.5 text-brand-ink-700">{c?.name ?? "—"}</td>
                                <td className="px-4 py-2.5 text-right font-semibold text-brand-ink-900">{formatXof(Number(p.amount))}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}

                  {financeDetail === "outstanding" && (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10 bg-brand-warm-50">
                        <tr className="text-left text-xs font-black uppercase tracking-[0.12em] text-brand-ink-500">
                          <th className="px-4 py-3">{locale === "zh" ? "房号" : "Chambre"}</th>
                          <th className="px-4 py-3">{locale === "zh" ? "客户" : "Client"}</th>
                          <th className="px-4 py-3">{locale === "zh" ? "入住" : "Arrivee"}</th>
                          <th className="px-4 py-3 text-right">{locale === "zh" ? "应收" : "Du"}</th>
                          <th className="px-4 py-3 text-right">{locale === "zh" ? "已收" : "Encaisse"}</th>
                          <th className="px-4 py-3 text-right">{locale === "zh" ? "欠款" : "Impaye"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-warm-100">
                        {financeStats.outstandingBookings.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-10 text-center text-brand-ink-400">{locale === "zh" ? "无未收款项" : "Aucun impaye"}</td></tr>
                        ) : (
                          [...financeStats.outstandingBookings].sort((a, b) => {
                            const aOut = Number(a.final_amount_xof ?? a.total_amount_xof) - Number(a.prepaid_amount_xof ?? 0);
                            const bOut = Number(b.final_amount_xof ?? b.total_amount_xof) - Number(b.prepaid_amount_xof ?? 0);
                            return bOut - aOut;
                          }).map(b => {
                            const u = dailyUnits.find(u => u.id === b.unit_id);
                            const c = customerMap.get(b.customer_id);
                            const final = Number(b.final_amount_xof ?? b.total_amount_xof);
                            const prepaid = Number(b.prepaid_amount_xof ?? 0);
                            return (
                              <tr key={b.id} className="hover:bg-brand-warm-50">
                                <td className="px-4 py-2.5 font-medium text-brand-ink-900">{u?.unit_no ?? "—"}</td>
                                <td className="px-4 py-2.5 text-brand-ink-700">{c?.name ?? "—"}</td>
                                <td className="px-4 py-2.5 text-brand-ink-600">{b.check_in}</td>
                                <td className="px-4 py-2.5 text-right text-brand-ink-900">{formatXof(final)}</td>
                                <td className="px-4 py-2.5 text-right text-brand-green-700">{formatXof(prepaid)}</td>
                                <td className="px-4 py-2.5 text-right font-semibold text-brand-indigo-700">{formatXof(final - prepaid)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}

                  {financeDetail === "settled" && (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10 bg-brand-warm-50">
                        <tr className="text-left text-xs font-black uppercase tracking-[0.12em] text-brand-ink-500">
                          <th className="px-4 py-3">{locale === "zh" ? "房号" : "Chambre"}</th>
                          <th className="px-4 py-3">{locale === "zh" ? "客户" : "Client"}</th>
                          <th className="px-4 py-3">{locale === "zh" ? "入住" : "Arrivee"}</th>
                          <th className="px-4 py-3">{locale === "zh" ? "退房" : "Depart"}</th>
                          <th className="px-4 py-3 text-right">{locale === "zh" ? "金额" : "Montant"}</th>
                          <th className="px-4 py-3">{locale === "zh" ? "状态" : "Statut"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-warm-100">
                        {financeStats.settledBookings.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-10 text-center text-brand-ink-400">{locale === "zh" ? "本月暂无结算" : "Aucun reglement ce mois"}</td></tr>
                        ) : (
                          [...financeStats.settledBookings].sort((a, b) => {
                            const aD = (a.checkout_mode === "open" ? a.actual_check_out : a.check_out) ?? "";
                            const bD = (b.checkout_mode === "open" ? b.actual_check_out : b.check_out) ?? "";
                            return bD.localeCompare(aD);
                          }).map(b => {
                            const u = dailyUnits.find(u => u.id === b.unit_id);
                            const c = customerMap.get(b.customer_id);
                            const final = Number(b.final_amount_xof ?? b.total_amount_xof);
                            const prepaid = Number(b.prepaid_amount_xof ?? 0);
                            const isPaid = prepaid >= final;
                            return (
                              <tr key={b.id} className="hover:bg-brand-warm-50">
                                <td className="px-4 py-2.5 font-medium text-brand-ink-900">{u?.unit_no ?? "—"}</td>
                                <td className="px-4 py-2.5 text-brand-ink-700">{c?.name ?? "—"}</td>
                                <td className="px-4 py-2.5 text-brand-ink-600">{b.check_in}</td>
                                <td className="px-4 py-2.5 text-brand-ink-600">{b.checkout_mode === "open" ? b.actual_check_out : b.check_out}</td>
                                <td className="px-4 py-2.5 text-right font-semibold text-brand-ink-900">{formatXof(final)}</td>
                                <td className="px-4 py-2.5">
                                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-bold", isPaid ? "bg-brand-green-100 text-brand-green-700" : "bg-brand-amber-100 text-brand-amber-700")}>
                                    {isPaid ? (locale === "zh" ? "已付清" : "Paye") : (locale === "zh" ? "未付清" : "Impaye")}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
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
  onCompleteCleaning,
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
  onCompleteCleaning?: () => void;
}) {
  const baseCell = cn(
    "group relative border-b border-r border-brand-warm-100 transition-colors",
    isToday ? "bg-brand-indigo-50/45" : "bg-white",
  );

  if (isMaintenance) {
    return (
      <div className={baseCell} style={{ height: ROW_HEIGHT }} role="gridcell">
        <div className="absolute inset-x-1.5 top-1/2 h-8 -translate-y-1/2 rounded-lg border border-brand-red-200 bg-brand-red-50" />
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
            "absolute top-1/2 flex h-8 -translate-y-1/2 items-center overflow-hidden px-2 text-left shadow-sm transition-all hover:-translate-y-[54%] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo-500",
            tone,
            isStart ? "left-1.5 rounded-l-xl" : "-left-px rounded-l-none",
            isEnd ? "right-1.5 rounded-r-xl" : "-right-px rounded-r-none",
          )}
          title={`${name} · ${dateRange}`}
          onClick={() => onOpenBooking(booking.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onOpenBooking(booking.id);
          }}
        >
          {isStart && (
            <span className="min-w-0">
              <span className="block truncate text-xs font-black leading-3">{name}</span>
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
          className="absolute inset-x-1.5 top-1/2 h-8 -translate-y-1/2 rounded-lg bg-brand-warm-100 text-xs font-bold text-brand-ink-400"
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
        <button
          type="button"
          className="absolute inset-x-1.5 top-1/2 flex h-8 -translate-y-1/2 items-center justify-center rounded-lg border border-brand-green-200 bg-brand-green-50 text-xs font-black text-brand-green-700 transition-all hover:border-brand-green-300 hover:bg-brand-green-100 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo-500"
          onClick={() => onCompleteCleaning?.()}
        >
          {copy.cleaning}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        baseCell,
        "flex cursor-pointer items-center justify-center hover:bg-brand-indigo-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand-indigo-500",
      )}
      style={{ height: ROW_HEIGHT }}
      aria-label={`${unit.unit_no} ${dateStr}`}
      onClick={onNewBooking}
      onKeyDown={(event) => {
        if (event.key === "Enter") onNewBooking();
      }}
    >
      <Plus className="hidden h-4 w-4 text-brand-indigo-500 group-hover:block group-focus-visible:block" />
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
        className="sticky left-0 z-10 flex items-center border-b border-r border-brand-warm-200 bg-brand-warm-50 px-3 text-xs font-black uppercase tracking-[0.12em] text-brand-ink-500"
        style={{ height: FLOOR_ROW_HEIGHT }}
      >
        {floor}
      </div>
      <div
        className="flex items-center border-b border-brand-warm-200 bg-brand-warm-50 px-3 text-xs font-bold text-brand-ink-400"
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
    dark: "border-brand-indigo-200 bg-brand-indigo-50 text-brand-indigo-900",
    orange: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
    teal: "border-brand-cyan-200 bg-brand-cyan-50 text-brand-cyan-900",
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

function FinanceCard({ label, value, tone, onClick }: { label: string; value: string; tone: "dark" | "orange" | "green"; onClick: () => void }) {
  const styles = {
    dark: "border-brand-warm-200 bg-white hover:border-brand-warm-300 hover:shadow-card",
    orange: "border-brand-amber-200 bg-brand-amber-50 hover:border-brand-amber-300 hover:shadow-card",
    green: "border-brand-green-200 bg-brand-green-50 hover:border-brand-green-300 hover:shadow-card",
  }[tone];
  const barColors = {
    dark: "bg-brand-ink-800",
    orange: "bg-brand-indigo-500",
    green: "bg-brand-green-500",
  }[tone];
  return (
    <button type="button" onClick={onClick} className={cn("flex min-h-[64px] overflow-hidden rounded-2xl border text-left shadow-sm transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo-500 hover:-translate-y-0.5", styles)}>
      <div className={cn("w-1.5 shrink-0", barColors)} />
      <div className="flex min-w-0 flex-1 flex-col justify-between px-4 py-3">
        <p className="truncate text-xs font-bold uppercase tracking-[0.08em] text-brand-ink-500">{label}</p>
        <p className="truncate text-lg font-black tracking-tight tabular-nums text-brand-ink-900">{value}</p>
      </div>
    </button>
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
        "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-black shadow-sm transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo-500",
        active ? "border-brand-indigo-500 bg-brand-indigo-500 text-white" : "border-brand-warm-300 bg-white text-brand-ink-700 hover:border-brand-indigo-200 hover:bg-brand-indigo-50",
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
        active ? "bg-white text-brand-indigo-700 shadow-sm" : "text-brand-ink-500 hover:text-brand-ink-900",
      )}
    >
      {children}
    </button>
  );
}

function getBookingTone(status: string): string {
  if (status === "checked_in") return "bg-brand-indigo-500 text-white shadow-brand-indigo-100";
  if (status === "confirmed") return "bg-brand-amber-100 text-brand-amber-900 ring-1 ring-inset ring-brand-amber-300 shadow-brand-amber-100";
  if (status === "pending_review") return "bg-brand-amber-500 text-white shadow-brand-amber-100";
  return "bg-brand-warm-100 text-brand-ink-500 shadow-brand-warm-200";
}

function getRoomTone(unit: UnitRow, hasCleaning: boolean, isMaintenance: boolean) {
  if (isMaintenance) return { strip: "bg-brand-red-500" };
  if (hasCleaning || unit.status === "cleaning_pending") return { strip: "bg-brand-green-500" };
  if (unit.status === "reserved") return { strip: "bg-brand-amber-500" };
  if (unit.status === "daily_occupied") return { strip: "bg-brand-indigo-500" };
  return { strip: "bg-brand-green-500" };
}

function getUnitTimelineStatus(
  unit: UnitRow,
  visibleDays: Date[],
  bookingMap: Map<string, Map<string, DailyBookingRow>>,
  unitCleaningMap: Map<string, string>,
  todayStr?: string,
): Exclude<RoomFilter, "all"> {
  if (!MAINTENANCE_STATUSES.has(unit.status)) return "maintenance";
  if (unitCleaningMap.has(unit.id) || unit.status === "cleaning_pending") return "cleaning";

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
  return addDays(start, 8);
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


function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}
