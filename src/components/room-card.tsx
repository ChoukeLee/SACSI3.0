"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { RoomVisualStatus } from "@/lib/status-styles";

const STATUS_COLORS: Record<RoomVisualStatus, { bg: string; badge: string; text: string; dot: string }> = {
  sold:           { bg: "bg-[#505080]", badge: "bg-white text-[#303052]", text: "text-white", dot: "bg-white/60" },
  leased:         { bg: "bg-[#7050A0]", badge: "bg-white text-[#51347A]", text: "text-white", dot: "bg-white/60" },
  dailyOccupied:  { bg: "bg-[#5090C0]", badge: "bg-white text-[#2C628B]", text: "text-white", dot: "bg-white/60" },
  reserved:       { bg: "bg-[#A0C0E0]", badge: "bg-white text-[#315E83]", text: "text-[#1F4564]", dot: "bg-white/70" },
  cleaningPending:{ bg: "bg-[#5AB5B8]", badge: "bg-white text-[#32757A]", text: "text-white", dot: "bg-white/60" },
  maintenance:    { bg: "bg-[#F0A080]", badge: "bg-white text-[#8A4A32]", text: "text-[#673522]", dot: "bg-white/70" },
  available:      { bg: "bg-[#F0E0D0]", badge: "bg-white text-[#5D4B3F]", text: "text-[#4F4238]", dot: "bg-white/80" },
};

interface RoomCardBase {
  roomNo: string;
  status: RoomVisualStatus;
  statusLabel: string;
  className?: string;
}

interface RoomCardMatrix extends RoomCardBase {
  variant: "matrix";
  customerName?: string;
  dateText?: string;
  href?: string;
  onClick?: never;
  children?: never;
}

interface RoomCardDetail extends RoomCardBase {
  variant: "detail";
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}

type RoomCardProps = RoomCardMatrix | RoomCardDetail;

export function RoomCard(props: RoomCardProps) {
  const { roomNo, status, statusLabel, className } = props;
  const c = STATUS_COLORS[status];

  if (props.variant === "matrix") {
    const { customerName, dateText, href } = props;
    const inner = (
      <div className={cn("grid h-[96px] w-[150px] grid-rows-[24px_1fr_28px] rounded-[15px] border border-white/10 px-3 py-2.5 shadow-sm transition-all duration-150 hover:shadow-md", c.bg, className)}>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <span className={cn("inline-flex h-[22px] min-w-[44px] items-center justify-center rounded-full px-2 font-mono text-[11px] font-bold leading-none shadow-sm ring-1 ring-inset ring-white/20", c.badge)}>
            {roomNo}
          </span>
          {dateText && (
            <span className="truncate pt-0.5 text-[10px] font-semibold leading-none text-current/70">{dateText}</span>
          )}
        </div>
        <div className="flex min-w-0 items-center justify-center px-1">
          <p className="truncate text-center text-[13px] font-bold leading-tight text-current">
            {customerName ?? statusLabel}
          </p>
        </div>
        <div className="flex items-end justify-center gap-2.5">
          <span className="text-[10px] font-semibold text-current/70">{statusLabel}</span>
        </div>
      </div>
    );

    if (href) {
      return (
        <Link href={href} title={`${roomNo} - ${statusLabel}`} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo-500">
          {inner}
        </Link>
      );
    }
    return inner;
  }

  // variant === "detail"
  const { children, href, onClick } = props;
  const Wrapper = href ? Link : onClick ? "button" : "div";
  const wrapperProps = href
    ? { href, className: "block text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo-500" }
    : onClick
    ? { onClick, type: "button" as const, className: "w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo-500" }
    : {};

  return (
    // @ts-expect-error dynamic wrapper element
    <Wrapper {...wrapperProps}>
      <div className={cn("flex flex-col gap-3 rounded-2xl border border-white/10 p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md", c.bg, c.text, className)}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 font-mono text-xs font-bold shadow-sm ring-1 ring-inset ring-white/20", c.badge)}>
            {roomNo}
          </span>
          <span className={cn("h-2 w-2 rounded-full", c.dot)} />
        </div>
        <p className="text-xs font-bold">{statusLabel}</p>
        {children}
      </div>
    </Wrapper>
  );
}

export { type RoomVisualStatus };
