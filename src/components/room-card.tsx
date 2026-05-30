"use client"

import Link from "next/link"
import { Info, ReceiptText, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type RoomStatus =
  | "sold"
  | "leased"
  | "daily_occupied"
  | "dailyOccupied"
  | "reserved"
  | "cleaning_pending"
  | "cleaningPending"
  | "maintenance"
  | "available"

/* ── Status → color mapping ── */
type CardColors = { bg: string; badge: string; nameColor: string; metaColor: string; btnBg: string };
const statusStyle: Record<RoomStatus, CardColors> = {
  sold:            { bg: "bg-[#075A9A]", badge: "bg-white/[0.94] text-[#17324D]", nameColor: "text-[rgba(255,255,255,0.94)]", metaColor: "text-[rgba(255,255,255,0.78)]", btnBg: "bg-white/[0.82]" },
  leased:          { bg: "bg-[#E8E2FF]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#5D7186]",                    btnBg: "bg-white/[0.88]" },
  daily_occupied:  { bg: "bg-[#62B6F5]", badge: "bg-white/[0.94] text-[#17324D]", nameColor: "text-[rgba(255,255,255,0.94)]", metaColor: "text-[rgba(255,255,255,0.78)]", btnBg: "bg-white/[0.82]" },
  dailyOccupied:   { bg: "bg-[#62B6F5]", badge: "bg-white/[0.94] text-[#17324D]", nameColor: "text-[rgba(255,255,255,0.94)]", metaColor: "text-[rgba(255,255,255,0.78)]", btnBg: "bg-white/[0.82]" },
  reserved:        { bg: "bg-[#FFF6D8]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#5D7186]",                    btnBg: "bg-white/[0.88]" },
  cleaning_pending:{ bg: "bg-[#D9F7F0]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#5D7186]",                    btnBg: "bg-white/[0.88]" },
  cleaningPending: { bg: "bg-[#D9F7F0]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#5D7186]",                    btnBg: "bg-white/[0.88]" },
  maintenance:     { bg: "bg-[#FFE2EA]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#5D7186]",                    btnBg: "bg-white/[0.88]" },
  available:       { bg: "bg-[#EAF7FF]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#5D7186]",                    btnBg: "bg-white/[0.88]" },
}

interface Props {
  roomNo: string
  status: RoomStatus
  statusLabel?: string
  customerName?: string
  dateText?: string
  href?: string
  onClick?: () => void
  className?: string
  children?: React.ReactNode
}

/* ── Light circular button, 25×25, subtle ── */
function ActionBtn({ icon: Icon, label, btnBg }: { icon: typeof Info; label: string; btnBg: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[25px] w-[25px] items-center justify-center rounded-full border border-[rgba(23,50,77,0.08)] transition-all",
        btnBg,
        "hover:bg-white/95 hover:-translate-y-px hover:shadow-[0_2px_4px_rgba(25,58,92,0.08)]",
      )}
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5 text-[rgba(23,50,77,0.78)]" strokeWidth={1.5} />
    </span>
  )
}

export function RoomCard({ roomNo, status, statusLabel, customerName, dateText, href, onClick, className, children }: Props) {
  const s = statusStyle[status] ?? statusStyle.available

  /* ── Detail variant (leases / sales) ── */
  if (children) {
    const inner = (
      <div className={cn(
        "flex flex-col gap-3 rounded-lg border border-[rgba(23,50,77,0.08)] p-4 shadow-[0_8px_18px_rgba(25,58,92,0.08)]",
        s.bg, s.nameColor, className,
      )}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex rounded-full px-2 py-1 font-mono text-xs font-bold", s.badge)}>{roomNo}</span>
          <span className={cn("h-2 w-2 rounded-full", s.nameColor, "opacity-40")} />
        </div>
        {statusLabel && <p className="text-xs font-bold opacity-80">{statusLabel}</p>}
        {children}
      </div>
    )
    if (href) return <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{inner}</Link>
    if (onClick) return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }} className="block cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{inner}</div>
    return inner
  }

  /* ── Matrix variant — hotel PMS card ── */
  const inner = (
    <div className={cn(
      "relative h-[94px] w-[150px] rounded-lg border border-[rgba(23,50,77,0.08)] shadow-[0_8px_18px_rgba(25,58,92,0.08)]",
      "font-[\"Segoe_UI\",\"PingFang_SC\",\"Microsoft_YaHei\",system-ui,sans-serif]",
      s.bg, className,
    )}>
      {/* Room number capsule — shorter, rounder: h:22, min-w:38, px:8 */}
      <span className={cn(
        "absolute top-[10px] left-3 inline-flex h-[22px] min-w-[38px] items-center justify-center rounded-full px-2 text-center text-[12px] font-bold leading-[22px]",
        "shadow-[0_1px_2px_rgba(25,58,92,0.06)]",
        s.badge,
      )}>
        {roomNo}
      </span>

      {/* Right info group — date + name, right-aligned */}
      <div className="absolute top-[12px] right-3 left-[60px] overflow-hidden text-right">
        <p className={cn("text-[11px] font-medium leading-[1.1] tracking-[0] truncate", s.metaColor)}>
          {dateText || ""}
        </p>
        <p className={cn("mt-[8px] text-[13px] font-medium leading-[1.15] tracking-[0] truncate", s.nameColor)}>
          {customerName || "可安排入住"}
        </p>
      </div>

      {/* Action buttons — centered bottom, gap 10px */}
      <div className="absolute inset-x-0 bottom-[10px] flex items-center justify-center gap-[10px]">
        <ActionBtn icon={Info} label="详情" btnBg={s.btnBg} />
        <ActionBtn icon={ReceiptText} label="财务" btnBg={s.btnBg} />
        <ActionBtn icon={ArrowRight} label="进入" btnBg={s.btnBg} />
      </div>
    </div>
  )
  if (href) return <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{inner}</Link>
  if (onClick) return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }} className="block cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{inner}</div>
  return inner
}
