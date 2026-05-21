"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BedDouble } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
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
  buildingName = "SASCI11",
}: MobileTodayWorkspaceProps) {
  const t = dictionaries[locale].mobile;
  const router = useRouter();
  const todayStr = new Date().toISOString().slice(0, 10);

  const roomStates = useMemo(
    () => computeRoomStates(dailyUnits, bookings, customers, cleaningTasks, payments, todayStr),
    [dailyUnits, bookings, customers, cleaningTasks, payments, todayStr],
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
      await completeCleaning(cleaningTarget.cleaningTask.id);
      router.replace(window.location.pathname + window.location.search + (window.location.search ? '&' : '?') + '_t=' + Date.now());
    } catch (e) {
      console.error("Cleaning completion failed:", e);
    } finally {
      setActionLoading(false);
      setCleaningTarget(null);
    }
  }, [cleaningTarget, router]);

  const todayFormatted = new Date().toLocaleDateString(
    locale === "fr" ? "fr-FR" : "zh-CN",
    { weekday: "short", month: "short", day: "numeric" },
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-black text-slate-950">{t.today}</h1>
          <p className="text-[11px] text-slate-500">
            {buildingName}{locale === "zh" ? "公寓" : ""} · {todayFormatted}
          </p>
        </div>
      </div>

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
      <BedDouble className="mx-auto h-8 w-8 text-slate-300 mb-3" />
      <p className="text-sm text-slate-500">{message[activeTab] || empty.noRooms}</p>
    </div>
  );
}
