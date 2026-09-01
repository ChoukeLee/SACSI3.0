"use client";

import { ArrowRight, CalendarDays, Check, CreditCard, UserRound } from "lucide-react";
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
  const isReserved = room.displayStatus === "reserved";
  const isCleaning = room.displayStatus === "cleaning";
  const hasOutstanding = Boolean(room.billing && room.billing.outstanding > 0);

  const tone = isCheckingOut
    ? {
        border: "border-accentAmber-200",
        bar: "bg-accentAmber-500",
        soft: "bg-accentAmber-50 text-accentAmber-800",
      }
    : isReserved
      ? {
          border: "border-accentAmber-200",
          bar: "bg-accentAmber-400",
          soft: "bg-accentAmber-50 text-accentAmber-800",
        }
      : isCleaning
        ? {
            border: "border-emerald-200",
            bar: "bg-emerald-500",
            soft: "bg-emerald-50 text-emerald-800",
          }
        : hasOutstanding
          ? {
              border: "border-accentRed-200",
              bar: "bg-accentRed-500",
              soft: "bg-accentRed-50 text-accentRed-700",
            }
          : {
              border: "border-border/80",
              bar: "bg-accentBlue-400",
              soft: "bg-accentBlue-50 text-accentBlue-700",
            };

  const stayText = room.booking
    ? [
        room.booking.check_in,
        room.booking.checkout_mode === "open"
          ? t.drawer.openEnded
          : room.booking.check_out || null,
      ]
        .filter(Boolean)
        .join(" -> ")
    : null;

  return (
    <button
      type="button"
      onClick={() => onPress(room)}
      className={cn(
        "flex w-full overflow-hidden rounded-xl border bg-card text-left shadow-card",
        "transition active:scale-[0.99] active:bg-muted/40",
        tone.border,
      )}
    >
      <span className={cn("w-1.5 shrink-0", tone.bar)} aria-hidden="true" />

      <div className="min-w-0 flex-1 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-xl font-semibold leading-none text-foreground tabular-nums">
                {room.unit.unit_no}
              </span>
              <StatusBadge status={unitStatus} label={dictionaries[locale].statuses[unitStatus]} />
            </div>
          </div>
          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
        </div>

        {(room.customer || room.booking) && (
          <div className="mt-3 space-y-1.5">
            {room.customer && (
              <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground/85">
                <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{room.customer.name}</span>
              </div>
            )}
            {stayText && (
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {stayText}
                  {room.billing && (
                    <span className="ml-1.5">
                      · {room.billing.nights}
                      {t.roomCard.nights}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {hasOutstanding && (
          <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-accentRed-50 px-2.5 py-1.5 text-xs font-bold text-accentRed-700">
            <CreditCard className="h-3.5 w-3.5 shrink-0" />
            <span>
              {locale === "zh" ? "欠费 " : "Du "}
              {formatXof(room.billing!.outstanding)}
            </span>
          </div>
        )}

        {isCleaning && (
          <div className={cn("mt-3 inline-flex rounded-lg px-2.5 py-1.5 text-xs font-bold", tone.soft)}>
            {locale === "zh" ? "等待保洁完成" : "En attente de menage"}
          </div>
        )}

        {isReserved && room.booking && (
          <div className={cn("mt-3 inline-flex rounded-lg px-2.5 py-1.5 text-xs font-bold", tone.soft)}>
            {locale === "zh" ? "预计入住 " : "Arrivee prevue "}
            {room.booking.check_in}
            {room.booking.check_out ? ` -> ${room.booking.check_out}` : ""}
          </div>
        )}

        {(isOccupied || isCleaning) && (
          <div className="mt-3 flex gap-2" onClick={(event) => event.stopPropagation()}>
            {isOccupied && onCheckOut && (
              <Button
                variant="default"
                size="sm"
                onClick={() => onCheckOut(room)}
                className="min-h-11 flex-1 justify-center rounded-lg"
              >
                {t.roomCard.checkOut}
              </Button>
            )}
            {isCleaning && onCompleteCleaning && room.cleaningTask && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCompleteCleaning(room)}
                className="min-h-11 flex-1 justify-center rounded-lg"
              >
                <Check className="h-3.5 w-3.5" />
                {t.roomCard.cleaningDone}
              </Button>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
