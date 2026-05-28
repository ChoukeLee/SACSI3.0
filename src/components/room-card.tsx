"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { RoomVisualStatus } from "@/lib/status-styles";

const COLORS: Record<RoomVisualStatus, { bg: string; badge: string; text: string }> = {
  sold:           { bg: "bg-[#505080]", badge: "bg-white/90 text-[#303052]", text: "text-white" },
  leased:         { bg: "bg-[#7050A0]", badge: "bg-white/90 text-[#51347A]", text: "text-white" },
  dailyOccupied:  { bg: "bg-[#5090C0]", badge: "bg-white/90 text-[#2C628B]", text: "text-white" },
  reserved:       { bg: "bg-[#A0C0E0]", badge: "bg-white/90 text-[#315E83]", text: "text-[#1F4564]" },
  cleaningPending:{ bg: "bg-[#5AB5B8]", badge: "bg-white/90 text-[#32757A]", text: "text-white" },
  maintenance:    { bg: "bg-[#F0A080]", badge: "bg-white/90 text-[#8A4A32]", text: "text-[#673522]" },
  available:      { bg: "bg-[#F0E0D0]", badge: "bg-white/90 text-[#5D4B3F]", text: "text-[#4F4238]" },
};

interface Props {
  variant: "matrix" | "detail";
  roomNo: string;
  status: RoomVisualStatus;
  statusLabel: string;
  href?: string;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
  customerName?: string;
  dateText?: string;
}

export function RoomCard({ variant, roomNo, status, statusLabel, href, onClick, className, children, customerName, dateText }: Props) {
  const c = COLORS[status];
  const base = cn("rounded-2xl border border-white/10 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md", c.bg, c.text);
  const badge = cn("inline-flex rounded-full px-2.5 py-1 font-mono text-xs font-bold shadow-sm ring-1 ring-inset ring-white/20", c.badge);
  const dot = cn("h-2 w-2 rounded-full", status === "available" || status === "reserved" ? "bg-white/70" : "bg-white/50");

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={badge}>{roomNo}</span>
        {variant === "matrix" && <span className={dot} />}
        {dateText && <span className="text-xs opacity-70">{dateText}</span>}
      </div>
      {variant === "matrix" ? (
        <div className="flex flex-col items-center justify-center flex-1 min-h-0">
          <p className="text-sm font-bold">{customerName ?? statusLabel}</p>
          <p className="text-xs opacity-70">{statusLabel}</p>
        </div>
      ) : (
        <div className="mt-1">
          <p className="text-xs font-bold">{statusLabel}</p>
          {children}
        </div>
      )}
    </>
  );

  if (href) return <Link href={href} className={cn(base, "flex flex-col", variant === "matrix" ? "h-[96px] w-[150px] p-2.5" : "p-4")}>{inner}</Link>;
  return <div className={cn(base, "flex flex-col cursor-pointer", variant === "matrix" ? "h-[96px] w-[150px] p-2.5" : "p-4")} onClick={onClick}>{inner}</div>;
}

export { type RoomVisualStatus };
