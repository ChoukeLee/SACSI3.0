"use client";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusDisplayLabel } from "@/lib/display-labels";
import { getUnitOperationalLabel } from "@/lib/unit-display";
import { StatTile } from "@/components/ui/operational";
import type { Locale } from "@/lib/i18n";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { CustomerSummary } from "./customer-summary";
import type { COPY } from "./calendar-constants";
import { ROW_HEIGHT, FLOOR_ROW_HEIGHT, getBookingTone } from "./calendar-model";

export function TimelineCell({
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
  showCheckedInLabel,
  locale,
  copy,
  bookingLabels,
  canCreateBooking,
  canOperateDaily,
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
  showCheckedInLabel: boolean;
  locale: Locale;
  copy: (typeof COPY)[Locale];
  bookingLabels: Record<string, string>;
  canCreateBooking: boolean;
  canOperateDaily: boolean;
  onOpenBooking: (id: string) => void;
  onNewBooking: () => void;
  onCompleteCleaning?: () => void;
}) {
  const baseCell = cn(
    "group relative border-b border-r transition-colors",
    isToday ? "bg-accent/50" : "bg-card",
  );

  if (isMaintenance) {
    const statusLabel =
      unit.status === "locked"
        ? getUnitOperationalLabel(unit, locale) || (locale === "zh" ? "锁定" : "Bloque")
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
    const dateRange =
      booking.checkout_mode === "open"
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
          {showCheckedInLabel && (
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold leading-3">{name}</span>
              <span className="block truncate text-[8px] font-semibold opacity-85">
                {bookingLabels[booking.status] ?? statusDisplayLabel(booking.status, locale)}
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
    const upcomingName =
      booking && (booking.status === "confirmed" || booking.status === "pending_review")
        ? (customer?.name ?? "").slice(0, 4)
        : "";
    return (
      <div className={baseCell} style={{ height: ROW_HEIGHT }} role="gridcell">
        <button
          type="button"
          className="absolute inset-x-1 top-1/2 flex h-7 -translate-y-1/2 items-center justify-center gap-1 rounded-lg bg-[#D9F7F0] border border-[#A8E8DB] text-xs font-bold text-[#17324D] transition-all hover:bg-[#C0EFE4] hover:shadow-sm focus-visible:ring-ring"
          disabled={!canOperateDaily}
          onClick={() => canOperateDaily && onCompleteCleaning?.()}
        >
          {copy.cleaning}
          {upcomingName && <span className="font-normal text-[#17324D]/60">{upcomingName}</span>}
        </button>
      </div>
    );
  }

  // Confirmed / pending_review — only shown when no cleaning is pending
  if (booking && booking.status !== "checked_out") {
    const tone = getBookingTone(booking.status);
    const name = customer?.name ?? "?";
    const dateRange =
      booking.checkout_mode === "open"
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
                {bookingLabels[booking.status] ?? statusDisplayLabel(booking.status, locale)}
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
          {isStart ? (customer?.name?.slice(0, 4) ?? "") : ""}
        </button>
      </div>
    );
  }

  const isPast = dateStr < todayStr;
  if (isPast) {
    return <div className={baseCell} style={{ height: ROW_HEIGHT }} role="gridcell" />;
  }

  if (!canCreateBooking) {
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

export function FloorRow({
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

export function ShareCard({
  label,
  value,
  units,
  tone,
}: {
  label: string;
  value: number;
  units: string[];
  tone: ShareTone;
}) {
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

export function FinanceCard({
  label,
  value,
  caption,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  caption: string;
  tone: "dark" | "orange" | "green";
  onClick: () => void;
}) {
  const tileTone = {
    dark: "neutral",
    orange: "amber",
    green: "green",
  }[tone] as "neutral" | "amber" | "green";

  return (
    <StatTile
      label={label}
      value={value}
      caption={caption}
      tone={tileTone}
      onClick={onClick}
      className="min-h-[84px]"
    />
  );
}

export function FilterButton({
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
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground/80 hover:bg-muted",
      )}
    >
      {icon ?? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      <span>{label}</span>
      <span className={cn("tabular-nums", active ? "text-white/85" : "text-muted-foreground/70")}>
        {count}
      </span>
    </button>
  );
}
