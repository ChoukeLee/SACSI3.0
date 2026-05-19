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
    case "cleaning":
      return "cleaning_pending";
    case "available":
      return "available";
    default:
      return "available";
  }
}

export function MobileRoomCard({
  room,
  locale,
  onPress,
  onCheckOut,
  onCompleteCleaning,
}: MobileRoomCardProps) {
  const t = dictionaries[locale].mobile;
  const unitStatus = displayStatusToUnitStatus(room.displayStatus);

  const isCheckingOut = room.displayStatus === "checking_out_today";
  const isOccupied = room.displayStatus === "occupied" || isCheckingOut;
  const isCleaning = room.displayStatus === "cleaning";

  return (
    <button
      type="button"
      onClick={() => onPress(room)}
      className={cn(
        "w-full rounded-xl border bg-white p-3.5 shadow-card text-left transition-colors duration-fast active:bg-brand-warm-50",
        isCheckingOut
          ? "border-brand-amber-200 bg-brand-amber-50/50"
          : isCleaning
            ? "border-brand-sky-200 bg-brand-sky-50/50"
            : "border-brand-warm-400",
      )}
    >
      <div className="flex items-start justify-between">
        {/* Room number — visual center */}
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xl font-bold leading-none text-brand-ink-900">
            {room.unit.unit_no}
          </span>
          <StatusBadge status={unitStatus} locale={locale} />
        </div>
        <ArrowRight className="h-4 w-4 text-brand-ink-300 shrink-0 mt-0.5" />
      </div>

      {/* Secondary info row */}
      {(room.customer || room.booking) && (
        <div className="mt-2 flex items-center justify-between">
          <div className="min-w-0">
            {room.customer && (
              <p className="text-xs font-medium text-brand-ink-700 truncate">
                {room.customer.name}
              </p>
            )}
            {room.booking && (
              <p className="text-[11px] text-brand-ink-400 mt-0.5">
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

      {/* Billing alert — only when outstanding > 0 */}
      {room.billing && room.billing.outstanding > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-brand-red-600">
          <CreditCard className="h-3 w-3" />
          <span>
            {locale === "zh" ? "欠费 " : "Dû "}{formatXof(room.billing.outstanding)}
          </span>
        </div>
      )}

      {/* Cleaning room: no billing info needed */}
      {isCleaning && (
        <div className="mt-2 text-[11px] text-brand-ink-400">
          {locale === "zh" ? "退房后等待保洁" : "En attente de ménage"}
        </div>
      )}

      {/* Quick action buttons */}
      <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
        {isOccupied && onCheckOut && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => onCheckOut(room)}
            className="flex-1 justify-center text-xs min-h-[36px]"
          >
            {t.roomCard.checkOut}
          </Button>
        )}
        {isCleaning && onCompleteCleaning && room.cleaningTask && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => onCompleteCleaning(room)}
            className="flex-1 justify-center text-xs min-h-[36px]"
          >
            <Check className="inline h-3.5 w-3.5 mr-1" />
            {t.roomCard.cleaningDone}
          </Button>
        )}
      </div>
    </button>
  );
}
