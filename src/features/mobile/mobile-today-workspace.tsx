"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, Building2, CalendarDays, RefreshCw } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { MobileStatsBar } from "./mobile-stats-bar";
import { MobileRoomCard } from "./mobile-room-card";
import { MobileRoomDrawer } from "./mobile-room-drawer";
import { ConfirmDialog } from "./confirm-dialog";
import {
  computeRoomStates,
  getOccupiedRooms,
  getTodayCheckouts,
  getReservedRooms,
  getCleaningRooms,
  getAvailableRooms,
  getAllActiveRooms,
  type RoomState,
  type RoomDisplayStatus,
} from "./room-state";
import { checkOut, completeCleaning } from "@/features/daily-rentals/actions";

interface MobileTodayWorkspaceProps {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  locale: Locale;
  buildingName?: string;
}

export function MobileTodayWorkspace({
  dailyUnits,
  bookings,
  customers,
  payments,
  cleaningTasks,
  locale,
  buildingName = "SACSI11",
}: MobileTodayWorkspaceProps) {
  const t = dictionaries[locale].mobile;
  const router = useRouter();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [optimisticCompletedCleaningIds, setOptimisticCompletedCleaningIds] = useState<Set<string>>(() => new Set());
  const [optimisticUnitStatuses, setOptimisticUnitStatuses] = useState<Map<string, UnitStatus>>(() => new Map());

  const visibleDailyUnits = useMemo(() => {
    if (optimisticUnitStatuses.size === 0) return dailyUnits;
    return dailyUnits.map((unit) => {
      const status = optimisticUnitStatuses.get(unit.id);
      return status ? { ...unit, status } : unit;
    });
  }, [dailyUnits, optimisticUnitStatuses]);

  const visibleCleaningTasks = useMemo(() => {
    if (optimisticCompletedCleaningIds.size === 0) return cleaningTasks;
    return cleaningTasks.map((task) => (
      optimisticCompletedCleaningIds.has(task.id) ? { ...task, is_completed: true } : task
    ));
  }, [cleaningTasks, optimisticCompletedCleaningIds]);

  useEffect(() => {
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
      for (const unit of dailyUnits) {
        const optimisticStatus = next.get(unit.id);
        if (optimisticStatus && unit.status === optimisticStatus) next.delete(unit.id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [cleaningTasks, dailyUnits]);

  const roomStates = useMemo(
    () => computeRoomStates(visibleDailyUnits, bookings, customers, visibleCleaningTasks, payments, todayStr),
    [visibleDailyUnits, bookings, customers, visibleCleaningTasks, payments, todayStr],
  );

  const occupied = useMemo(() => getOccupiedRooms(roomStates), [roomStates]);
  const todayCheckouts = useMemo(() => getTodayCheckouts(roomStates), [roomStates]);
  const reserved = useMemo(() => getReservedRooms(roomStates), [roomStates]);
  const cleaning = useMemo(() => getCleaningRooms(roomStates), [roomStates]);
  const available = useMemo(() => getAvailableRooms(roomStates), [roomStates]);

  // Occupied tab includes both checked-in guests and pending reservations
  const occupiedCount = occupied.length + todayCheckouts.length + reserved.length;
  const checkingOutCount = todayCheckouts.length;
  const cleaningCount = cleaning.length;
  const availableCount = available.length;

  const [activeTab, setActiveTab] = useState<RoomDisplayStatus>("checking_out_today");
  const [selectedRoom, setSelectedRoom] = useState<RoomState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState<RoomState | null>(null);
  const [cleaningTarget, setCleaningTarget] = useState<RoomState | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const filteredRooms = useMemo(() => {
    switch (activeTab) {
      case "occupied":
        // Show both checked-in and reserved together, reserved last
        return [...occupied, ...todayCheckouts, ...reserved];
      case "checking_out_today":
        return todayCheckouts;
      case "cleaning":
        return cleaning;
      case "available":
        return [...todayCheckouts, ...occupied, ...reserved, ...cleaning, ...available];
      default:
        return [];
    }
  }, [activeTab, occupied, todayCheckouts, reserved, cleaning, available]);

  const handleCardPress = useCallback((room: RoomState) => {
    setSelectedRoom(room);
    setDrawerOpen(true);
  }, []);

  const applyCompletedCleaning = useCallback((result: { taskId: string; unitId: string; unitStatus: UnitStatus }) => {
    setOptimisticCompletedCleaningIds((prev) => {
      const next = new Set(prev);
      next.add(result.taskId);
      return next;
    });
    setOptimisticUnitStatuses((prev) => {
      const next = new Map(prev);
      next.set(result.unitId, result.unitStatus);
      return next;
    });
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedRoom(null);
  }, []);

  const handleCheckOut = useCallback((room: RoomState) => {
    setCheckoutTarget(room);
  }, []);

  const handleCompleteCleaning = useCallback((room: RoomState) => {
    setCleaningTarget(room);
  }, []);

  const executeCheckOut = useCallback(async () => {
    if (!checkoutTarget?.booking) return;
    setActionLoading(true);
    try {
      await checkOut(checkoutTarget.booking.id, {});
      router.replace(window.location.pathname + window.location.search + (window.location.search ? '&' : '?') + '_t=' + Date.now());
    } catch (e) {
      console.error("Checkout failed:", e);
    } finally {
      setActionLoading(false);
      setCheckoutTarget(null);
    }
  }, [checkoutTarget, router]);

  const executeCleaning = useCallback(async () => {
    if (!cleaningTarget?.cleaningTask) return;
    setActionLoading(true);
    try {
      const result = await completeCleaning(cleaningTarget.cleaningTask.id);
      if (result.success && result.taskId && result.unitId && result.unitStatus) {
        applyCompletedCleaning({ taskId: result.taskId, unitId: result.unitId, unitStatus: result.unitStatus });
        router.refresh();
      }
    } catch (e) {
      console.error("Cleaning completion failed:", e);
    } finally {
      setActionLoading(false);
      setCleaningTarget(null);
    }
  }, [applyCompletedCleaning, cleaningTarget, router]);

  const todayFormatted = new Date().toLocaleDateString(
    locale === "fr" ? "fr-FR" : "zh-CN",
    { weekday: "short", month: "short", day: "numeric" },
  );

  return (
    <div className="space-y-4 pb-2">
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-start justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              <span className="truncate">{buildingName}{locale === "zh" ? "公寓" : ""}</span>
            </div>
            <h1 className="text-xl font-semibold leading-tight tracking-tight text-foreground">{t.today}</h1>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              <span>{todayFormatted}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm active:bg-muted"
            aria-label={locale === "zh" ? "刷新" : "Actualiser"}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-4 border-t border-border/70 bg-muted/35">
          <SummaryCell label={t.stats.checkingOut} value={checkingOutCount} tone="amber" />
          <SummaryCell label={t.stats.cleaning} value={cleaningCount} tone="teal" />
          <SummaryCell label={t.stats.occupied} value={occupiedCount} tone="blue" />
          <SummaryCell label={t.stats.available} value={availableCount} tone="green" />
        </div>
      </section>

      {/* Stats bar (also serves as tab switcher) */}
      <MobileStatsBar
        occupiedCount={occupiedCount}
        checkingOutCount={checkingOutCount}
        cleaningCount={cleaningCount}
        availableCount={availableCount}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        locale={locale}
      />

      {/* Room card list */}
      {filteredRooms.length > 0 ? (
        <div className="space-y-2.5">
          {filteredRooms.map((room) => (
            <MobileRoomCard
              key={room.unit.id}
              room={room}
              locale={locale}
              onPress={handleCardPress}
              onCheckOut={handleCheckOut}
              onCompleteCleaning={handleCompleteCleaning}
            />
          ))}
        </div>
      ) : (
        <EmptyState activeTab={activeTab} locale={locale} />
      )}

      {/* Room detail drawer */}
      <MobileRoomDrawer
        room={selectedRoom}
        open={drawerOpen}
        onClose={handleCloseDrawer}
        locale={locale}
        onCleaningCompleted={applyCompletedCleaning}
      />

      {/* Checkout confirmation */}
      <ConfirmDialog
        open={checkoutTarget !== null}
        onClose={() => setCheckoutTarget(null)}
        onConfirm={executeCheckOut}
        title={dictionaries[locale].mobile.actions.checkOutConfirm}
        description={dictionaries[locale].mobile.actions.checkOutDesc}
        locale={locale}
        loading={actionLoading}
      />

      {/* Cleaning confirmation */}
      <ConfirmDialog
        open={cleaningTarget !== null}
        onClose={() => setCleaningTarget(null)}
        onConfirm={executeCleaning}
        title={dictionaries[locale].mobile.actions.completeCleaning}
        locale={locale}
        loading={actionLoading}
      />
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "teal" | "blue" | "green";
}) {
  const color = {
    amber: "text-accentAmber-700",
    teal: "text-emerald-700",
    blue: "text-accentBlue-700",
    green: "text-accentGreen-700",
  }[tone];
  return (
    <div className="min-w-0 border-r border-border/60 px-3 py-3 last:border-r-0">
      <p className={cn("text-lg font-semibold leading-none tabular-nums", color)}>{value}</p>
      <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function EmptyState({
  activeTab,
  locale,
}: {
  activeTab: RoomDisplayStatus;
  locale: Locale;
}) {
  const empty = dictionaries[locale].mobile.empty;
  const message: Record<RoomDisplayStatus, string> = {
    occupied: empty.noOccupied,
    checking_out_today: empty.noCheckouts,
    reserved: empty.noReserved,
    cleaning: empty.noCleaning,
    available: empty.noRooms,
    maintenance: empty.noRooms,
    locked: empty.noRooms,
  };

  return (
    <div className="py-14 text-center">
      <BedDouble className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">{message[activeTab] || empty.noRooms}</p>
    </div>
  );
}
