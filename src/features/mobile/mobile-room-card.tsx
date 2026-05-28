"use client";

import { ArrowRight, CreditCard, Check } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { RoomState } from "./room-state";
import type { UnitStatus } from "@/types/domain";

interface MobileRoomCardProps {
  room: RoomState;
  locale: Locale;
  onPress: (room: RoomState) => void;
  onCheckOut?: (room: RoomState) => void;
  onCompleteCleaning?: (room: RoomState) => void;
}

function displayStatusToUnitStatus(status: RoomState["displayStatus"]): UnitStatus {
  switch (status) {
    case "occupied":
    case "checking_out_today":
      return "daily_occupied";
    case "reserved":
      return "reserved";
    case "cleaning":
      return "cleaning_pending";
    case "available":
      return "available";
    default:
      return "available";
  }
}

export function MobileRoomCard({
  room, locale, onPress, onCheckOut, onCompleteCleaning,
}: MobileRoomCardProps) {
  const t = dictionaries[locale].mobile;
  const unitStatus = displayStatusToUnitStatus(room.displayStatus);

  const isCheckingOut = room.displayStatus === "checking_out_today";
  const isOccupied = room.displayStatus === "occupied" || isCheckingOut;
  const isReserved = room.displayStatus === "reserved";
  const isCleaning = room.displayStatus === "cleaning";
  const hasOutstanding = room.billing && room.billing.outstanding > 0;

  return (
    <button
      type="button"
      onClick={() => onPress(room)}
      className={cn(
        "w-full rounded-xl border bg-white p-3.5 shadow-natural text-left",
        "transition-colors duration-[100ms] active:bg-brand-warm-50",
        isCheckingOut
          ? "border-brand-amber-200 bg-brand-amber-50/40"
          : isReserved
            ? "border-brand-amber-200 bg-brand-amber-50/30"
            : isCleaning
              ? "border-brand-cyan-200 bg-brand-cyan-50/40"
              : hasOutstanding
                ? "border-brand-red-200 bg-brand-red-50/30"
                : "border-brand-warm-200"
      )}
    >
      {/* Top row: room number + status + chevron */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-mono text-xl font-black leading-none text-brand-ink-900 tabular-nums">
            {room.unit.unit_no}
          </span>
          <StatusBadge status={unitStatus} labels={dictionaries[locale].statuses} />
        </div>
        <ArrowRight className="h-4 w-4 text-brand-ink-400 shrink-0 mt-0.5" />
      </div>

      {/* Guest & stay info */}
      {(room.customer || room.booking) && (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {room.customer && (
              <p className="text-[13px] font-semibold text-brand-ink-800 truncate">
                {room.customer.name}
              </p>
            )}
            {room.booking && (
              <p className="text-xs text-brand-ink-500 mt-0.5">
                {room.booking.check_in}
                {room.booking.checkout_mode === "open"
                  ? ` · ${t.drawer.openEnded}`
                  : room.booking.check_out
                    ? ` → ${room.booking.check_out}`
                    : ""}
                {room.billing && (
                  <span className="ml-1.5">
                    · {room.billing.nights}{t.roomCard.nights}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Outstanding balance alert */}
      {hasOutstanding && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-brand-red-50 px-2.5 py-1.5 text-xs font-semibold text-brand-red-600">
          <CreditCard className="h-3.5 w-3.5 shrink-0" />
          <span>
            {locale === "zh" ? "欠费 " : "Dû "}{formatXof(room.billing!.outstanding)}
          </span>
        </div>
      )}

      {/* Cleaning pending note */}
      {isCleaning && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-brand-ink-500">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-cyan-400" />
          {locale === "zh" ? "退房后等待保洁" : "En attente de menage"}
        </div>
      )}

      {/* Reserved pending note */}
      {isReserved && room.booking && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-brand-amber-700">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-amber-500" />
          {locale === "zh" ? "预计入住 " : "Arrivee prevue "}{room.booking.check_in}
          {room.booking.check_out && (
            <span> → {room.booking.check_out}</span>
          )}
        </div>
      )}

      {/* Quick action buttons */}
      {(isOccupied || isCleaning) && (
        <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
          {isOccupied && onCheckOut && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onCheckOut(room)}
              className="flex-1 justify-center min-h-[38px]"
            >
              {t.roomCard.checkOut}
            </Button>
          )}
          {isCleaning && onCompleteCleaning && room.cleaningTask && (
            <Button
              variant="accent"
              size="sm"
              onClick={() => onCompleteCleaning(room)}
              className="flex-1 justify-center min-h-[38px]"
            >
              <Check className="h-3.5 w-3.5" />
              {t.roomCard.cleaningDone}
            </Button>
          )}
        </div>
      )}
    </button>
  );
}
