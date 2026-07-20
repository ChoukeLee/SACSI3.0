"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Plus, Printer, SlidersHorizontal, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn, formatXof, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { COPY, BOOKING_STATUS_LABELS } from "./calendar-constants";
import { Button } from "@/components/ui/button";
import { SegmentedControl, StatTile } from "@/components/ui/operational";
import { OperationStatusBanner } from "@/components/operation-status-banner";
import { useBackgroundOperationStatus } from "@/hooks/use-optimistic-operation";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { BookingPanel } from "./booking-panel";
import { completeCleaning } from "./actions";
import type { DailyOperationSnapshot } from "./actions";
import { ConfirmDialog } from "@/features/mobile/confirm-dialog";
import { buildBookingMap, buildDailyRoomStateMap, getDailyRoomStateForDate } from "./room-status";
import { getPrimaryDailyAction } from "./daily-rental-policy";
import { calculateBilling } from "./billing";

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  is_blacklisted: boolean;
  has_active_lease_contract?: boolean;
  has_active_sale_contract?: boolean;
}

interface CalendarProps {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerSummary[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  payments: { id: string; source_id: string; amount: number; payment_date: string }[];
  locale: Locale;
  userRole?: string;
}

type ViewMode = "day" | "week" | "month";
type RoomFilter = "all" | "available" | "occupied" | "checkingOutToday" | "openEnded" | "reserved" | "cleaning" | "maintenance";

const ROOM_COL_WIDTH = 120;
const ROW_HEIGHT = 36;
const FLOOR_ROW_HEIGHT = 16;
const MAINTENANCE_STATUSES = new Set(["available", "reserved", "daily_occupied", "cleaning_pending", "leased", "sold"]);

const NAV_BTN =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-white hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const TOOLBAR_SURFACE = "flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/45 p-1 shadow-xs";
const TOOLBAR_ITEM =
  "inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:bg-white hover:text-foreground";
const TOOLBAR_META = cn(TOOLBAR_ITEM, "text-[13px] font-medium text-foreground tabular-nums hover:bg-card hover:text-foreground");


export function DailyCalendar({
  dailyUnits,
  bookings: serverBookings,
  customers,
  cleaningTasks,
  payments,
  locale,
}: CalendarProps) {
  const copy = COPY[locale];
  const bookingLabels = BOOKING_STATUS_LABELS[locale];
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [roomFilter, setRoomFilter] = useState<RoomFilter>("all");
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [newBookingUnitId, setNewBookingUnitId] = useState<string | null>(null);
  const [newBookingDate, setNewBookingDate] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [optimisticBookings, setOptimisticBookings] = useState<DailyBookingRow[]>([]);
  const [optimisticBookingPatches, setOptimisticBookingPatches] = useState<Map<string, Partial<DailyBookingRow>>>(() => new Map());
  const [optimisticPayments, setOptimisticPayments] = useState<{ id: string; source_id: string; amount: number; payment_date: string }[]>([]);
  const [optimisticCleaningTasks, setOptimisticCleaningTasks] = useState<{ id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[]>([]);
  const [optimisticCompletedCleaningIds, setOptimisticCompletedCleaningIds] = useState<Set<string>>(() => new Set());
  const [optimisticUnitStatuses, setOptimisticUnitStatuses] = useState<Map<string, UnitStatus>>(() => new Map());
  const { operation: backgroundOperation, reportOperation: reportBackgroundOperation } = useBackgroundOperationStatus();
  const [cleaningTarget, setCleaningTarget] = useState<{ taskId: string; unitNo: string } | null>(null);
  const [cleaningLoading, setCleaningLoading] = useState(false);
  const calendarViewportRef = useRef<HTMLDivElement | null>(null);

  const bookings = useMemo(() => {
    const applyPatch = (booking: DailyBookingRow) => {
      const patch = optimisticBookingPatches.get(booking.id);
      return patch ? { ...booking, ...patch } : booking;
    };
    const seen = new Set(optimisticBookings.map((booking) => booking.id));
    return [
      ...optimisticBookings.map(applyPatch),
      ...serverBookings.filter((booking) => !seen.has(booking.id)).map(applyPatch),
    ];
  }, [serverBookings, optimisticBookings, optimisticBookingPatches]);

  const visibleDailyUnits = useMemo(() => {
    if (optimisticUnitStatuses.size === 0) return dailyUnits;
    return dailyUnits.map((unit) => {
      const status = optimisticUnitStatuses.get(unit.id);
      return status ? { ...unit, status } : unit;
    });
  }, [dailyUnits, optimisticUnitStatuses]);

  const visibleCleaningTasks = useMemo(() => {
    const serverTaskIds = new Set(cleaningTasks.map((task) => task.id));
    const pendingOptimisticTasks = optimisticCleaningTasks.filter((task) => !serverTaskIds.has(task.id));
    const mergedTasks = [...pendingOptimisticTasks, ...cleaningTasks];
    if (optimisticCompletedCleaningIds.size === 0) return mergedTasks;
    return mergedTasks.map((task) => (
      optimisticCompletedCleaningIds.has(task.id) ? { ...task, is_completed: true } : task
    ));
  }, [cleaningTasks, optimisticCleaningTasks, optimisticCompletedCleaningIds]);

  const visiblePayments = useMemo(() => {
    const serverPaymentIds = new Set(payments.map((payment) => payment.id));
    return [
      ...optimisticPayments.filter((payment) => !serverPaymentIds.has(payment.id)),
      ...payments,
    ];
  }, [payments, optimisticPayments]);

  useEffect(() => {
    setOptimisticBookings((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((optimisticBooking) => !serverBookings.some((booking) => (
        booking.unit_id === optimisticBooking.unit_id &&
        booking.customer_id === optimisticBooking.customer_id &&
        booking.check_in === optimisticBooking.check_in &&
        (booking.check_out ?? null) === (optimisticBooking.check_out ?? null)
      )));
      return next.length === prev.length ? prev : next;
    });
    setOptimisticBookingPatches((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      const serverBookingIds = new Set(serverBookings.map((booking) => booking.id));
      for (const booking of serverBookings) {
        const patch = next.get(booking.id);
        if (!patch) continue;
        if (serverMatchesPatch(booking, patch)) {
          next.delete(booking.id);
        }
      }
      for (const bookingId of next.keys()) {
        if (!serverBookingIds.has(bookingId)) next.delete(bookingId);
      }
      return next.size === prev.size ? prev : next;
    });
    setOptimisticPayments((prev) => {
      if (prev.length === 0) return prev;
      const serverPaymentIds = new Set(payments.map((payment) => payment.id));
      const next = prev.filter((payment) => !serverPaymentIds.has(payment.id));
      return next.length === prev.length ? prev : next;
    });
    setOptimisticCleaningTasks((prev) => {
      if (prev.length === 0) return prev;
      const serverOpenTaskKeys = new Set(cleaningTasks.filter((task) => !task.is_completed).map((task) => `${task.unit_id}:${task.daily_booking_id ?? ""}`));
      const next = prev.filter((task) => !serverOpenTaskKeys.has(`${task.unit_id}:${task.daily_booking_id ?? ""}`));
      return next.length === prev.length ? prev : next;
    });
    setOptimisticCompletedCleaningIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const task of cleaningTasks) {
        if (task.is_completed) next.delete(task.id);
      }
      return next.size === prev.size ? prev : next;
    });
    setOptimisticUnitStatuses((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      const serverUnitIds = new Set(dailyUnits.map((unit) => unit.id));
      for (const unit of dailyUnits) {
        const optimisticStatus = next.get(unit.id);
        if (!optimisticStatus) continue;
        if (unit.status === optimisticStatus) {
          next.delete(unit.id);
        }
      }
      for (const unitId of next.keys()) {
        if (!serverUnitIds.has(unitId)) next.delete(unitId);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [serverBookings, payments, cleaningTasks, dailyUnits]);

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

  const clearOptimisticState = useCallback(() => {
    setOptimisticBookings([]);
    setOptimisticBookingPatches(new Map());
    setOptimisticPayments([]);
    setOptimisticCleaningTasks([]);
    setOptimisticCompletedCleaningIds(new Set());
    setOptimisticUnitStatuses(new Map());
  }, []);

  const applyOperationSnapshot = useCallback((snapshot: DailyOperationSnapshot) => {
    if (snapshot.booking) {
      const booking = snapshot.booking;
      setOptimisticBookings((prev) => {
        const withoutBooking = prev.filter((item) => item.id !== booking.id);
        const existsOnServer = serverBookings.some((item) => item.id === booking.id);
        return existsOnServer || booking.status === "cancelled" ? withoutBooking : [booking, ...withoutBooking];
      });
      setOptimisticBookingPatches((prev) => {
        const next = new Map(prev);
        next.set(booking.id, booking);
        return next;
      });
    }
    if (snapshot.unit) {
      setOptimisticUnitStatuses((prev) => {
        const next = new Map(prev);
        next.set(snapshot.unit!.id, snapshot.unit!.status);
        return next;
      });
    }
    if (snapshot.booking) {
      setOptimisticPayments((prev) => {
        const snapshotIds = new Set(snapshot.payments.map((payment) => payment.id));
        const withoutBookingPayments = prev.filter((payment) => payment.source_id !== snapshot.booking!.id);
        return [
          ...snapshot.payments.map((payment) => ({
            id: payment.id,
            source_id: payment.source_id ?? "",
            amount: Number(payment.amount),
            payment_date: payment.payment_date,
          })),
          ...withoutBookingPayments.filter((payment) => !snapshotIds.has(payment.id)),
        ];
      });
    }
    if (snapshot.unit) {
      const openTasks = snapshot.cleaningTasks.filter((task) => !task.is_completed);
      setOptimisticCleaningTasks((prev) => [
        ...openTasks.map((task) => ({
          id: task.id,
          unit_id: task.unit_id,
          daily_booking_id: task.daily_booking_id,
          is_completed: task.is_completed,
        })),
        ...prev.filter((task) => task.unit_id !== snapshot.unit!.id),
      ]);
      setOptimisticCompletedCleaningIds((prev) => {
        const next = new Set(prev);
        for (const task of snapshot.cleaningTasks) {
          if (task.is_completed) next.add(task.id);
          else next.delete(task.id);
        }
        return next;
      });
    }
  }, [serverBookings]);

  const bookingById = useMemo(() => {
    const map = new Map<string, DailyBookingRow>();
    for (const booking of bookings) map.set(booking.id, booking);
    return map;
  }, [bookings]);

  const unitById = useMemo(() => {
    const map = new Map<string, UnitRow>();
    for (const unit of visibleDailyUnits) map.set(unit.id, unit);
    return map;
  }, [visibleDailyUnits]);

  const unitCleaningMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of visibleCleaningTasks) {
      if (!task.is_completed) map.set(task.unit_id, task.id);
    }
    return map;
  }, [visibleCleaningTasks]);

  const todayStateMap = useMemo(
    () => buildDailyRoomStateMap({ dailyUnits: visibleDailyUnits, dateStr: todayStr, bookings, cleaningTasks: visibleCleaningTasks }),
    [visibleDailyUnits, todayStr, bookings, visibleCleaningTasks],
  );

  const filterCounts = useMemo(() => {
    const counts: Record<RoomFilter, number> = {
      all: visibleDailyUnits.length,
      available: 0,
      occupied: 0,
      checkingOutToday: 0,
      openEnded: 0,
      reserved: 0,
      cleaning: 0,
      maintenance: 0,
    };
    for (const unit of visibleDailyUnits) {
      counts[getUnitTimelineStatus(unit, visibleDays, bookingMap, unitCleaningMap, todayStr)]++;
    }
    counts.occupied += counts.checkingOutToday + counts.openEnded;
    return counts;
  }, [visibleDailyUnits, visibleDays, bookingMap, unitCleaningMap, todayStr]);

  const filteredUnits = useMemo(() => {
    return visibleDailyUnits.filter((unit) => {
      if (roomFilter === "all") return true;
      const status = getUnitTimelineStatus(unit, visibleDays, bookingMap, unitCleaningMap, todayStr);
      if (roomFilter === "occupied") return status === "occupied" || status === "checkingOutToday" || status === "openEnded";
      return status === roomFilter;
    });
  }, [bookingMap, visibleDailyUnits, roomFilter, unitCleaningMap, visibleDays, todayStr]);

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

    for (const p of visiblePayments) {
      if (p.payment_date.startsWith(currentMonth)) {
        monthCollected += Number(p.amount);
        collectedPayments.push(p);
      }
    }

    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      const billing = calculateBilling(b, todayStr);
      const final = billing.finalAmount;
      const outstanding = billing.outstanding;

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
  }, [bookings, visiblePayments, todayStr]);

  const collectedPaymentGroups = useMemo(() => {
    const groups = new Map<string, {
      id: string;
      paymentDates: string[];
      amount: number;
      count: number;
      booking: DailyBookingRow | null;
      unit: UnitRow | null;
      customer: CustomerSummary | null;
      stayRange: string;
      sortDate: string;
    }>();

    for (const payment of financeStats.collectedPayments) {
      const booking = payment.source_id ? bookingById.get(payment.source_id) ?? null : null;
      const unit = booking ? unitById.get(booking.unit_id) ?? null : null;
      const customer = booking ? customerMap.get(booking.customer_id) ?? null : null;
      const key = booking ? `booking:${booking.id}` : `payment:${payment.id}`;
      const stayEnd = booking
        ? ((booking.checkout_mode === "open" ? booking.actual_check_out : booking.check_out) ?? booking.check_out)
        : null;
      const stayRange = booking ? `${booking.check_in} → ${stayEnd ?? (locale === "zh" ? "未退房" : "En cours")}` : "—";
      const existing = groups.get(key);

      if (existing) {
        existing.paymentDates.push(payment.payment_date);
        existing.amount += Number(payment.amount);
        existing.count += 1;
        if (payment.payment_date > existing.sortDate) existing.sortDate = payment.payment_date;
        continue;
      }

      groups.set(key, {
        id: key,
        paymentDates: [payment.payment_date],
        amount: Number(payment.amount),
        count: 1,
        booking,
        unit,
        customer,
        stayRange,
        sortDate: payment.payment_date,
      });
    }

    return Array.from(groups.values()).sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  }, [bookingById, customerMap, unitById, financeStats.collectedPayments, locale]);

  const financeCards = useMemo(() => [
    { key: "collected", label: locale === "zh" ? "本月已收" : "Encaisse", value: formatXof(financeStats.monthCollected), tone: "green" as const },
    { key: "outstanding", label: locale === "zh" ? "当前欠款" : "Impaye", value: formatXof(financeStats.currentOutstanding), tone: "orange" as const },
    { key: "settled", label: locale === "zh" ? "本月结算" : "Regle", value: formatXof(financeStats.monthSettled), tone: "dark" as const },
  ], [financeStats, locale]);

  const shareRows = useMemo(() => {
    const occupied = visibleDailyUnits.filter((u) => {
      const s = todayStateMap.get(u.id);
      return s && (s.status === "occupied" || s.status === "checking_out_today" || s.status === "reserved");
    });
    const checkingOut = visibleDailyUnits.filter((u) => {
      const s = todayStateMap.get(u.id);
      return s?.isCheckoutDay;
    });
    const cleaning = visibleDailyUnits.filter((u) => {
      const s = todayStateMap.get(u.id);
      return s?.status === "cleaning";
    });
    const available = visibleDailyUnits.filter((u) => {
      const s = todayStateMap.get(u.id);
      return s?.status === "available";
    });
    return [
      { key: "occupied", label: locale === "zh" ? "占用" : "Occupe", count: occupied.length, units: occupied.map((u) => u.unit_no), tone: "dark" as const },
      { key: "checkout", label: locale === "zh" ? "今日离店" : "Depart", count: checkingOut.length, units: checkingOut.map((u) => u.unit_no), tone: "orange" as const },
      { key: "cleaning", label: locale === "zh" ? "待保洁" : "Menage", count: cleaning.length, units: cleaning.map((u) => u.unit_no), tone: "teal" as const },
      { key: "available", label: locale === "zh" ? "可安排入住" : "Disponible", count: available.length, units: available.map((u) => u.unit_no), tone: "green" as const },
    ];
  }, [visibleDailyUnits, todayStateMap, locale]);

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

  const panelBooking = selectedBookingId ? bookingById.get(selectedBookingId) ?? null : null;

  useEffect(() => {
    const viewport = calendarViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = 0;
    viewport.scrollLeft = 0;
  }, [rangeLabel, roomFilter, viewMode]);

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

  if (visibleDailyUnits.length === 0) {
    return (
      <div data-daily-calendar-root className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card py-12 text-center shadow-card">
        <p className="text-sm text-muted-foreground">{copy.noRooms}</p>
      </div>
    );
  }

  return (
    <div data-daily-calendar-root className="relative isolate space-y-5">
      <OperationStatusBanner operation={backgroundOperation} locale={locale} />
      <section className="relative z-20 overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight">{locale === "zh" ? "日租概览" : "Apercu journalier"}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{locale === "zh" ? "今日房态、群消息和日租收款" : "Occupation, message et paiements du jour"}</p>
          </div>
          <div className={TOOLBAR_SURFACE}>
            <div className={TOOLBAR_META}>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span>{new Date(todayStr).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN")}</span>
              <span className="text-xs font-medium text-muted-foreground">{new Date(todayStr).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { weekday: "long" })}</span>
            </div>
            <Button
              variant={copied ? "default" : "ghost"}
              size="sm"
              onClick={handleCopy}
              className={cn(
                TOOLBAR_ITEM,
                copied && "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
              )}
              aria-live="polite"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? (locale === "zh" ? "已复制" : "Copie") : (locale === "zh" ? "复制群消息" : "Copier")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.print()} className={cn(TOOLBAR_ITEM, "no-print")}>
              <Printer className="h-3.5 w-3.5" />
              {locale === "zh" ? "打印" : "Imprimer"}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 bg-card px-4 py-3 md:grid-cols-2 xl:grid-cols-4">
          {shareRows.map((row) => (
            <ShareCard key={row.key} label={row.label} value={row.count} units={row.units} tone={row.tone} />
          ))}
        </div>
        <div className="grid gap-3 border-t border-border bg-card px-4 py-3 md:grid-cols-3">
          {financeCards.map((card) => (
            <FinanceCard key={card.key} label={card.label} value={card.value} tone={card.tone} onClick={() => setFinanceDetail(card.key as "collected" | "outstanding" | "settled")} />
          ))}
        </div>
      </section>

      <section className="relative z-10 overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{copy.timeline}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{copy.subtitle}</p>
          </div>

          <div className={TOOLBAR_SURFACE}>
            <FilterButton
              active={roomFilter === "all"}
              onClick={() => setRoomFilter("all")}
              icon={<SlidersHorizontal className="h-4 w-4" />}
              label={copy.allRooms}
              count={filterCounts.all}
            />
            <FilterButton active={roomFilter === "occupied"} onClick={() => setRoomFilter("occupied")} color="#62B6F5" label={copy.occupied} count={filterCounts.occupied} />
            <FilterButton active={roomFilter === "checkingOutToday"} onClick={() => setRoomFilter("checkingOutToday")} color="#E8C840" label={locale === "zh" ? "今日离店" : "Depart"} count={filterCounts.checkingOutToday} />
            <FilterButton active={roomFilter === "openEnded"} onClick={() => setRoomFilter("openEnded")} color="#62B6F5" label={locale === "zh" ? "未定离店" : "Ouvert"} count={filterCounts.openEnded} />
            <FilterButton active={roomFilter === "reserved"} onClick={() => setRoomFilter("reserved")} color="#E8C840" label={copy.reserved} count={filterCounts.reserved} />
            <FilterButton active={roomFilter === "cleaning"} onClick={() => setRoomFilter("cleaning")} color="#5CC4B8" label={copy.cleaning} count={filterCounts.cleaning} />
            <FilterButton active={roomFilter === "available"} onClick={() => setRoomFilter("available")} color="#A0D0E8" label={copy.available} count={filterCounts.available} />
            <FilterButton active={roomFilter === "maintenance"} onClick={() => setRoomFilter("maintenance")} color="#F08090" label={copy.maintenance} count={filterCounts.maintenance} />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-border px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <SegmentedControl
            value={viewMode}
            onChange={setMode}
            ariaLabel={locale === "zh" ? "日历视图" : "Vue calendrier"}
            className="h-9 self-start rounded-lg"
            items={[
              { value: "day", label: copy.day },
              { value: "week", label: copy.week },
              { value: "month", label: copy.month },
            ]}
          />

          <div className={TOOLBAR_SURFACE}>
            <button onClick={() => moveRange(-1)} className={NAV_BTN} aria-label="previous range">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className={cn(TOOLBAR_META, "min-w-[180px] justify-center px-3 text-center")}>
              {rangeLabel}
            </div>
            <button onClick={() => moveRange(1)} className={NAV_BTN} aria-label="next range">
              <ChevronRight className="h-4 w-4" />
            </button>
            <Button onClick={goToToday} size="sm" variant="ghost" className={TOOLBAR_ITEM}>{copy.today}</Button>
          </div>
        </div>

        <div
          ref={calendarViewportRef}
          data-daily-calendar-viewport
          className="min-h-[360px] overflow-hidden rounded-b-xl [contain:paint]"
        >
          <div
            className="relative grid min-w-[760px] w-full"
            style={{ gridTemplateColumns: `${ROOM_COL_WIDTH}px repeat(${visibleDays.length}, minmax(132px, 1fr))` }}
            data-daily-calendar-grid
            role="grid"
            aria-label={copy.timeline}
          >
            <div
              className="z-30 flex items-center border-b border-r bg-card px-3 text-xs font-semibold text-muted-foreground"
              style={{ height: 40, left: "auto", position: "relative" }}
              data-daily-calendar-room-label
            >
              <span className="sr-only">{copy.room}</span>
            </div>
            {visibleDays.map((date) => {
              const dateStr = toDateStr(date);
              const isToday = dateStr === todayStr;
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <div
                  key={dateStr}
                  className={cn(
                    "flex flex-col items-center justify-center border-b border-r border-border text-xs",
                    isToday && "bg-accent text-accent-foreground",
                    isWeekend && !isToday && "bg-muted/30 text-muted-foreground",
                    !isToday && !isWeekend && "bg-card text-muted-foreground",
                  )}
                  style={{ height: 40 }}
                  role="columnheader"
                >
                  <span className="text-xs font-medium leading-3">{date.toLocaleDateString(localeStr, { weekday: "short" })}</span>
                  <span className="text-[15px] font-semibold leading-5 text-foreground">{date.getDate()}</span>
                  {isToday && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
                </div>
              );
            })}

            {unitsByFloor.length === 0 ? (
              <div
                className="flex h-24 items-center justify-center text-sm font-medium text-muted-foreground"
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
                  return [
                    <div
                      key={`${unit.id}-room`}
                      className="z-10 flex items-center border-b border-r bg-card px-3"
                      style={{ height: ROW_HEIGHT, left: "auto", position: "relative" }}
                      role="rowheader"
                      data-daily-calendar-room-label
                      title={`11#${unit.unit_no}`}
                    >
                      <span className={cn("mr-2 h-7 w-1.5 rounded-full", roomTone.strip)} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold leading-4 text-foreground">
                          11#{unit.unit_no}
                        </div>
                      </div>
                    </div>,
                    ...visibleDays.map((date) => {
                      const dateStr = toDateStr(date);
                      const prevDateStr = toDateStr(addDays(date, -1));
                      const nextDateStr = toDateStr(addDays(date, 1));
                      const booking = unitBM?.get(dateStr) ?? null;
                      const dateRoomState = getDailyRoomStateForDate({
                        unit,
                        dateStr,
                        bookings,
                        cleaningTasks: visibleCleaningTasks,
                      });
                      const prevSame = booking && unitBM?.get(prevDateStr)?.id === booking.id;
                      const nextSame = booking && unitBM?.get(nextDateStr)?.id === booking.id;
                      const isToday = dateStr === todayStr;

                      return (
                        <TimelineCell
                          key={`${unit.id}-${dateStr}`}
                          unit={unit}
                          dateStr={dateStr}
                          todayStr={todayStr}
                          booking={booking}
                          customer={booking ? customerMap.get(booking.customer_id) ?? null : null}
                          hasCleaning={hasCleaning}
                          isMaintenance={isMaintenance}
                          isToday={isToday}
                          isStart={!prevSame}
                          isEnd={!nextSame}
                          locale={locale}
                          copy={copy}
                          bookingLabels={bookingLabels}
                          onOpenBooking={(id) => {
                            setSelectedBookingId(id);
                            setNewBookingUnitId(null);
                            setNewBookingDate(null);
                          }}
                          onNewBooking={() => {
                            const action = getPrimaryDailyAction({
                              roomDisplayStatus: dateRoomState.status,
                              unitStatus: unit.status as UnitStatus,
                              hasOpenCleaningTask: hasCleaning,
                              isPastDate: dateStr < todayStr,
                            });
                            if (action.action === "create_booking" && action.allowed) {
                              setNewBookingUnitId(unit.id);
                              setNewBookingDate(dateStr);
                              setSelectedBookingId(null);
                            }
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
          units={visibleDailyUnits}
          customers={customers}
          cleaningTasks={visibleCleaningTasks}
          payments={visiblePayments}
          locale={locale}
          onClose={() => {
            setSelectedBookingId(null);
            setNewBookingUnitId(null);
            setNewBookingDate(null);
            clearOptimisticState();
          }}
          onOptimisticClose={() => {
            setSelectedBookingId(null);
            setNewBookingUnitId(null);
            setNewBookingDate(null);
          }}
          onChanged={() => { setTick((t) => t + 1); }}
          onBookingCreated={(booking) => setOptimisticBookings((prev) => [booking, ...prev])}
          onBookingPatched={(bookingId, patch) => setOptimisticBookingPatches((prev) => {
            const next = new Map(prev);
            next.set(bookingId, { ...(next.get(bookingId) ?? {}), ...patch });
            return next;
          })}
          onUnitStatusPatched={(targetUnitId, status) => setOptimisticUnitStatuses((prev) => {
            const next = new Map(prev);
            next.set(targetUnitId, status);
            return next;
          })}
          onCleaningTaskAdded={(task) => setOptimisticCleaningTasks((prev) => [task, ...prev])}
          onCleaningTaskCompleted={(taskId, targetUnitId, status) => {
            setOptimisticCompletedCleaningIds((prev) => {
              const next = new Set(prev);
              next.add(taskId);
              return next;
            });
            setOptimisticUnitStatuses((prev) => {
              const next = new Map(prev);
              next.set(targetUnitId, status);
              return next;
            });
          }}
          onPaymentAdded={(payment) => setOptimisticPayments((prev) => [payment, ...prev])}
          onOperationSnapshot={applyOperationSnapshot}
          onOptimisticReset={() => {
            clearOptimisticState();
          }}
          onBackgroundOperation={reportBackgroundOperation}
        />
      )}

      <ConfirmDialog
        open={cleaningTarget !== null}
        onClose={() => setCleaningTarget(null)}
        onConfirm={() => {
          if (!cleaningTarget) return;
          setCleaningLoading(true);
          completeCleaning(cleaningTarget.taskId).then((result) => {
            if (result.success && result.data) {
              applyOperationSnapshot(result.data);
            }
            if (result.success && result.taskId && result.unitId && result.unitStatus) {
              setOptimisticCompletedCleaningIds((prev) => {
                const next = new Set(prev);
                next.add(result.taskId!);
                return next;
              });
              setOptimisticUnitStatuses((prev) => {
                const next = new Map(prev);
                next.set(result.unitId!, result.unitStatus!);
                return next;
              });
            }
            setCleaningLoading(false);
            setCleaningTarget(null);
            setTick((t) => t + 1);
          }).catch((error) => {
            console.error("Cleaning completion failed:", error);
            setCleaningLoading(false);
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
          <div className="fixed bottom-0 left-0 right-0 top-12 z-overlay bg-black/30 backdrop-blur-sm" onClick={() => setFinanceDetail(null)} />
          <div className="fixed bottom-0 left-0 right-0 top-12 z-panel overflow-auto border-l border-border bg-card shadow-panel md:left-[var(--sidebar-width)]" role="dialog">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
              <div>
                <h3 className="text-sm font-medium tracking-tight text-foreground">
                  {financeDetail === "collected" ? (locale === "zh" ? "本月已收明细" : "Paiements du mois") :
                   financeDetail === "outstanding" ? (locale === "zh" ? "当前欠款明细" : "Soldes impayes") :
                   (locale === "zh" ? "本月结算明细" : "Reglements du mois")}
                </h3>
              </div>
              <button onClick={() => setFinanceDetail(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* Summary */}
              <div className="flex flex-wrap gap-4 rounded-xl bg-muted/50 px-4 py-3 text-sm">
                {financeDetail === "collected" && (
                  <>
                    <div><span className="text-muted-foreground">{locale === "zh" ? "笔数" : "Nb"}: </span><span className="font-semibold">{financeStats.collectedPayments.length}</span></div>
                    <div><span className="text-muted-foreground">{locale === "zh" ? "合计" : "Total"}: </span><span className="font-semibold text-accentGreen-700">{formatXof(financeStats.monthCollected)}</span></div>
                  </>
                )}
                {financeDetail === "outstanding" && (
                  <>
                    <div><span className="text-muted-foreground">{locale === "zh" ? "欠款笔数" : "Nb"}: </span><span className="font-semibold">{financeStats.outstandingBookings.length}</span></div>
                    <div><span className="text-muted-foreground">{locale === "zh" ? "欠款合计" : "Total"}: </span><span className="font-semibold text-accentBlue-700">{formatXof(financeStats.currentOutstanding)}</span></div>
                  </>
                )}
                {financeDetail === "settled" && (
                  <>
                    <div><span className="text-muted-foreground">{locale === "zh" ? "笔数" : "Nb"}: </span><span className="font-semibold">{financeStats.settledBookings.length}</span></div>
                    <div><span className="text-muted-foreground">{locale === "zh" ? "合计" : "Total"}: </span><span className="font-semibold text-foreground">{formatXof(financeStats.monthSettled)}</span></div>
                  </>
                )}
              </div>

              {/* Table */}
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="overflow-hidden">
                  {financeDetail === "collected" && (
                    <table className="w-full table-fixed text-left text-[13px]">
                      <colgroup>
                        <col className="w-[20%]" />
                        <col className="w-[22%]" />
                        <col className="w-[10%]" />
                        <col className="w-[17%]" />
                        <col className="w-[8%]" />
                        <col className="w-[23%]" />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-muted/50">
                        <tr className="text-left text-xs font-semibold text-muted-foreground">
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "收款日期" : "Date"}</th>
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "居住日期" : "Sejour"}</th>
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "房号" : "Chambre"}</th>
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "客户" : "Client"}</th>
                          <th className="px-3 py-3 whitespace-nowrap text-center">{locale === "zh" ? "笔数" : "Nb"}</th>
                          <th className="px-3 py-3 whitespace-nowrap text-right">{locale === "zh" ? "已收合计" : "Total encaisse"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {collectedPaymentGroups.length === 0 ? (
                          <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground/70">{locale === "zh" ? "本月暂无收款" : "Aucun paiement ce mois"}</td></tr>
                        ) : (
                          collectedPaymentGroups.map((group) => {
                            const dates = Array.from(new Set(group.paymentDates)).sort();
                            const paymentDateLabel = dates.length === 1 ? dates[0] : `${dates[0]} / ${dates[dates.length - 1]}`;
                            return (
                              <tr key={group.id} className="hover:bg-muted/50">
                                <td className="px-3 py-2.5 whitespace-nowrap font-medium text-foreground">{paymentDateLabel}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/80">{group.stayRange}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/80">{group.unit?.unit_no ?? "—"}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/80">{group.customer?.name ?? "—"}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-center tabular-nums text-foreground/70">{group.count}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold text-foreground">{formatXof(group.amount)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}

                  {financeDetail === "outstanding" && (
                    <table className="w-full table-fixed text-left text-[13px]">
                      <colgroup>
                        <col className="w-[7%]" />
                        <col className="w-[11%]" />
                        <col className="w-[16%]" />
                        <col className="w-[11%]" />
                        <col className="w-[17%]" />
                        <col className="w-[17%]" />
                        <col className="w-[21%]" />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-muted/50">
                        <tr className="text-left text-xs font-semibold text-muted-foreground">
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "房号" : "Chambre"}</th>
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "客户" : "Client"}</th>
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "入住备注" : "Note séjour"}</th>
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "入住" : "Arrivee"}</th>
                          <th className="px-3 py-3 whitespace-nowrap text-right">{locale === "zh" ? "应收" : "Du"}</th>
                          <th className="px-3 py-3 whitespace-nowrap text-right">{locale === "zh" ? "已收" : "Encaisse"}</th>
                          <th className="px-3 py-3 whitespace-nowrap text-right">{locale === "zh" ? "欠款" : "Impaye"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {financeStats.outstandingBookings.length === 0 ? (
                          <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground/70">{locale === "zh" ? "无未收款项" : "Aucun impaye"}</td></tr>
                        ) : (
                          [...financeStats.outstandingBookings].sort((a, b) => {
                            const aOut = calculateBilling(a, todayStr).outstanding;
                            const bOut = calculateBilling(b, todayStr).outstanding;
                            if (bOut !== aOut) return bOut - aOut;
                            const dateCompare = a.check_in.localeCompare(b.check_in);
                            if (dateCompare !== 0) return dateCompare;
                            const aUnit = visibleDailyUnits.find(u => u.id === a.unit_id)?.unit_no ?? "";
                            const bUnit = visibleDailyUnits.find(u => u.id === b.unit_id)?.unit_no ?? "";
                            return aUnit.localeCompare(bUnit, undefined, { numeric: true });
                          }).map(b => {
                            const u = visibleDailyUnits.find(u => u.id === b.unit_id);
                            const c = customerMap.get(b.customer_id);
                            const billing = calculateBilling(b, todayStr);
                            return (
                              <tr key={b.id} className="hover:bg-muted/50">
                                <td className="px-3 py-2.5 whitespace-nowrap font-medium text-foreground">{u?.unit_no ?? "—"}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/80">{c?.name ?? "—"}</td>
                                <td className="overflow-hidden px-3 py-2.5 text-foreground/80">
                                  <span className="block truncate" title={b.notes ?? undefined}>{b.notes || "—"}</span>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/70">{b.check_in}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums text-foreground">{formatXof(billing.finalAmount)}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums text-accentGreen-700">{formatXof(billing.paid)}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold text-accentBlue-700">{formatXof(billing.outstanding)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}

                  {financeDetail === "settled" && (
                    <table className="w-full table-fixed text-left text-[13px]">
                      <colgroup>
                        <col className="w-[7%]" />
                        <col className="w-[10%]" />
                        <col className="w-[14%]" />
                        <col className="w-[11%]" />
                        <col className="w-[11%]" />
                        <col className="w-[15%]" />
                        <col className="w-[15%]" />
                        <col className="w-[17%]" />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-muted/50">
                        <tr className="text-left text-xs font-semibold text-muted-foreground">
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "房号" : "Chambre"}</th>
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "客户" : "Client"}</th>
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "入住备注" : "Note séjour"}</th>
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "入住" : "Arrivee"}</th>
                          <th className="px-3 py-3 whitespace-nowrap">{locale === "zh" ? "退房" : "Depart"}</th>
                          <th className="px-3 py-3 whitespace-nowrap text-right">{locale === "zh" ? "应收" : "Total"}</th>
                          <th className="px-3 py-3 whitespace-nowrap text-right">{locale === "zh" ? "已收" : "Paye"}</th>
                          <th className="px-3 py-3 whitespace-nowrap text-right">{locale === "zh" ? "未收" : "Impaye"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {financeStats.settledBookings.length === 0 ? (
                          <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground/70">{locale === "zh" ? "本月暂无结算" : "Aucun reglement ce mois"}</td></tr>
                        ) : (
                          [...financeStats.settledBookings].sort((a, b) => {
                            const aD = (a.checkout_mode === "open" ? a.actual_check_out : a.check_out) ?? "";
                            const bD = (b.checkout_mode === "open" ? b.actual_check_out : b.check_out) ?? "";
                            const dateCompare = bD.localeCompare(aD);
                            if (dateCompare !== 0) return dateCompare;
                            const aUnit = visibleDailyUnits.find(u => u.id === a.unit_id)?.unit_no ?? "";
                            const bUnit = visibleDailyUnits.find(u => u.id === b.unit_id)?.unit_no ?? "";
                            return aUnit.localeCompare(bUnit, undefined, { numeric: true });
                          }).map(b => {
                            const u = visibleDailyUnits.find(u => u.id === b.unit_id);
                            const c = customerMap.get(b.customer_id);
                            const billing = calculateBilling(b, todayStr);
                            return (
                              <tr key={b.id} className="hover:bg-muted/50">
                                <td className="px-3 py-2.5 whitespace-nowrap font-medium text-foreground">{u?.unit_no ?? "—"}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/80">{c?.name ?? "—"}</td>
                                <td className="overflow-hidden px-3 py-2.5 text-foreground/80">
                                  <span className="block truncate" title={b.notes ?? undefined}>{b.notes || "—"}</span>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/70">{b.check_in}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/70">{b.checkout_mode === "open" ? b.actual_check_out : b.check_out}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums text-foreground">{formatXof(billing.finalAmount)}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums text-accentGreen-700">{formatXof(billing.paid)}</td>
                                <td className={cn("px-3 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold", billing.outstanding > 0 ? "text-rose-600" : "text-accentGreen-700")}>
                                  {billing.outstanding > 0 ? formatXof(billing.outstanding) : (locale === "zh" ? "已付清" : "Paye")}
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
  todayStr,
  booking,
  customer,
  hasCleaning,
  isMaintenance,
  isToday,
  isStart,
  isEnd,
  locale,
  copy,
  bookingLabels,
  onOpenBooking,
  onNewBooking,
  onCompleteCleaning,
}: {
  unit: UnitRow;
  dateStr: string;
  todayStr: string;
  booking: DailyBookingRow | null;
  customer: CustomerSummary | null;
  hasCleaning: boolean;
  isMaintenance: boolean;
  isToday: boolean;
  isStart: boolean;
  isEnd: boolean;
  locale: Locale;
  copy: (typeof COPY)[Locale];
  bookingLabels: Record<string, string>;
  onOpenBooking: (id: string) => void;
  onNewBooking: () => void;
  onCompleteCleaning?: () => void;
}) {
  const baseCell = cn(
    "group relative border-b border-r transition-colors",
    isToday ? "bg-accent/50" : "bg-card",
  );

  if (isMaintenance) {
    const statusLabel = unit.status === "locked"
      ? (locale === "zh" ? "锁定" : "Bloque")
      : copy.maintenance;
    const statusTitle = unit.notes ? `${statusLabel} · ${unit.notes}` : statusLabel;

    return (
      <div className={baseCell} style={{ height: ROW_HEIGHT }} role="gridcell" title={statusTitle}>
        <div className="absolute inset-x-1 top-1/2 flex h-7 -translate-y-1/2 items-center justify-center rounded-lg border border-[#F5C0CC] bg-[#FFE2EA] px-1.5 text-xs font-semibold text-[#17324D]">
          <span className="truncate">{statusLabel}</span>
        </div>
      </div>
    );
  }

  // Checked-in guest — always takes priority
  if (booking && booking.status === "checked_in") {
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
            "absolute top-1/2 flex h-8 -translate-y-1/2 items-center overflow-hidden px-2 text-left shadow-sm transition-all hover:-translate-y-[54%] hover:shadow-md focus-visible:ring-ring",
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
              <span className="block truncate text-xs font-semibold leading-3">{name}</span>
              <span className="block truncate text-[8px] font-semibold opacity-85">
                {bookingLabels[booking.status] ?? booking.status}
              </span>
            </span>
          )}
        </button>
      </div>
    );
  }

  // Cleaning pending — takes priority over future bookings (confirmed/pending_review)
  if (hasCleaning || unit.status === "cleaning_pending") {
    // If a future booking exists, show its name as context alongside the cleaning status
    const upcomingName = booking && (booking.status === "confirmed" || booking.status === "pending_review")
      ? (customer?.name ?? "").slice(0, 4)
      : "";
    return (
      <div className={baseCell} style={{ height: ROW_HEIGHT }} role="gridcell">
        <button
          type="button"
          className="absolute inset-x-1 top-1/2 flex h-7 -translate-y-1/2 items-center justify-center gap-1 rounded-lg bg-[#D9F7F0] border border-[#A8E8DB] text-xs font-bold text-[#17324D] transition-all hover:bg-[#C0EFE4] hover:shadow-sm focus-visible:ring-ring"
          onClick={() => onCompleteCleaning?.()}
        >
          {copy.cleaning}
          {upcomingName && (
            <span className="font-normal text-[#17324D]/60">{upcomingName}</span>
          )}
        </button>
      </div>
    );
  }

  // Confirmed / pending_review — only shown when no cleaning is pending
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
            "absolute top-1/2 flex h-8 -translate-y-1/2 items-center overflow-hidden px-2 text-left shadow-sm transition-all hover:-translate-y-[54%] hover:shadow-md focus-visible:ring-ring",
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
              <span className="block truncate text-xs font-semibold leading-3">{name}</span>
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
          className="absolute inset-x-1 top-1/2 h-7 -translate-y-1/2 rounded-md bg-muted text-xs font-medium text-muted-foreground"
          title={customer?.name ?? copy.occupied}
          onClick={() => onOpenBooking(booking.id)}
        >
          {isStart ? customer?.name?.slice(0, 4) ?? "" : ""}
        </button>
      </div>
    );
  }

  const isPast = dateStr < todayStr;
  if (isPast) {
    return <div className={baseCell} style={{ height: ROW_HEIGHT }} role="gridcell" />;
  }

  return (
    <button
      type="button"
      className={cn(
        baseCell,
        "flex cursor-pointer items-center justify-center hover:bg-accent focus-visible:outline-2 focus-visible:outline-inset focus-visible:ring-ring",
      )}
      style={{ height: ROW_HEIGHT }}
      aria-label={`${unit.unit_no} ${dateStr}`}
      onClick={onNewBooking}
      onKeyDown={(event) => {
        if (event.key === "Enter") onNewBooking();
      }}
    >
      <Plus className="hidden h-4 w-4 text-primary/60 group-hover:block group-focus-visible:block" />
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
        className="z-10 flex items-center border-b border-r bg-muted px-3 text-xs font-semibold text-muted-foreground"
        style={{ height: FLOOR_ROW_HEIGHT, left: "auto", position: "relative" }}
        data-daily-calendar-floor-label
      >
        {floor}
      </div>
      <div
        className="flex items-center border-b bg-muted px-3 text-xs font-medium text-muted-foreground"
        style={{ gridColumn: `span ${daysCount}`, height: FLOOR_ROW_HEIGHT }}
      >
        {count} {copy.unitCount}
      </div>
    </>
  );
}

type ShareTone = "dark" | "orange" | "teal" | "green";

function ShareCard({ label, value, units, tone }: { label: string; value: number; units: string[]; tone: ShareTone }) {
  const tileTone = {
    dark: "neutral",
    orange: "amber",
    teal: "teal",
    green: "green",
  }[tone] as "neutral" | "amber" | "teal" | "green";
  const candyClass = {
    dark: "border-border bg-[#F5F5F2]",
    orange: "border-[#FFD99A] bg-[#FFF3DF]",
    teal: "border-[#9BE8DC] bg-[#DDF8F2]",
    green: "border-[#BCEFD9] bg-[#EAFBF3]",
  }[tone];

  return (
    <StatTile
      label={label}
      value={value}
      caption={units.join(", ") || "-"}
      tone={tileTone}
      className={cn(
        "min-h-[118px] shadow-xs",
        candyClass,
        "[&>span:last-child]:whitespace-normal [&>span:last-child]:break-words [&>span:last-child]:leading-4",
      )}
    />
  );
}

function FinanceCard({ label, value, tone, onClick }: { label: string; value: string; tone: "dark" | "orange" | "green"; onClick: () => void }) {
  const tileTone = {
    dark: "neutral",
    orange: "amber",
    green: "green",
  }[tone] as "neutral" | "amber" | "green";

  return (
    <StatTile
      label={label}
      value={value}
      tone={tileTone}
      onClick={onClick}
      className="min-h-[84px]"
    />
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
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium shadow-xs transition-all focus-visible:ring-ring",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground/80 hover:bg-muted",
      )}
    >
      {icon ?? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      <span>{label}</span>
      <span className={cn("tabular-nums", active ? "text-white/85" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}

function getBookingTone(status: string): string {
  if (status === "checked_in") return "bg-[#62B6F5] text-white shadow-sm";
  if (status === "confirmed") return "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300";
  if (status === "pending_review") return "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200";
  return "bg-muted text-muted-foreground";
}

function getRoomTone(unit: UnitRow, hasCleaning: boolean, isMaintenance: boolean) {
  if (isMaintenance) return { strip: "bg-[#F08090]" };
  if (hasCleaning || unit.status === "cleaning_pending") return { strip: "bg-[#5CC4B8]" };
  if (unit.status === "reserved") return { strip: "bg-[#E8C840]" };
  if (unit.status === "daily_occupied") return { strip: "bg-[#62B6F5]" };
  if (unit.status === "leased") return { strip: "bg-[#5E9BC5]" };
  if (unit.status === "sold") return { strip: "bg-[#B88A48]" };
  return { strip: "bg-[#A0D0E8]" };
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

  if (unit.status === "daily_occupied" && todayStr && visibleDays.some((date) => toDateStr(date) === todayStr)) return "occupied";
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

function serverMatchesPatch<T extends object>(serverRow: T, patch: Partial<T>): boolean {
  const serverRecord = serverRow as Record<string, unknown>;
  const patchRecord = patch as Record<string, unknown>;
  for (const key of Object.keys(patchRecord)) {
    if (!(key in serverRecord)) continue;
    if ((serverRecord[key] ?? null) !== (patchRecord[key] ?? null)) return false;
  }
  return true;
}
