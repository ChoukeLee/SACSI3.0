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

const statusStyle: Record<RoomStatus, { bg: string; badge: string; text: string }> = {
  sold:            { bg: "bg-[#505080]", badge: "bg-white/90 text-[#303052]", text: "text-white" },
  leased:          { bg: "bg-[#7050A0]", badge: "bg-white/90 text-[#51347A]", text: "text-white" },
  daily_occupied:  { bg: "bg-[#5090C0]", badge: "bg-white/90 text-[#2C628B]", text: "text-white" },
  dailyOccupied:   { bg: "bg-[#5090C0]", badge: "bg-white/90 text-[#2C628B]", text: "text-white" },
  reserved:        { bg: "bg-[#A0C0E0]", badge: "bg-white/90 text-[#315E83]", text: "text-[#1F4564]" },
  cleaning_pending:{ bg: "bg-[#5AB5B8]", badge: "bg-white/90 text-[#32757A]", text: "text-white" },
  cleaningPending: { bg: "bg-[#5AB5B8]", badge: "bg-white/90 text-[#32757A]", text: "text-white" },
  maintenance:     { bg: "bg-[#F0A080]", badge: "bg-white/90 text-[#8A4A32]", text: "text-[#673522]" },
  available:       { bg: "bg-[#F0E0D0]", badge: "bg-white/90 text-[#5D4B3F]", text: "text-[#4F4238]" },
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

function ActionButton({ icon: Icon, label }: { icon: typeof Info; label: string }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/70 text-current shadow-sm ring-1 ring-inset ring-white/50 transition hover:scale-110" aria-label={label}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
    </span>
  )
}

export function RoomCard({ roomNo, status, statusLabel, customerName, dateText, href, onClick, className, children }: Props) {
  const s = statusStyle[status] ?? statusStyle.available

  // detail variant: if children are passed, use a flexible layout for lease/sale cards
  if (children) {
    const inner = (
      <div className={cn("flex flex-col gap-3 rounded-2xl border border-white/10 p-4 shadow-sm transition-shadow hover:shadow-md", s.bg, s.text, className)}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex rounded-full px-2.5 py-1 font-mono text-xs font-bold shadow-sm ring-1 ring-inset ring-white/20", s.badge)}>{roomNo}</span>
          <span className={cn("h-2 w-2 rounded-full", s.text, "opacity-50")} />
        </div>
        {statusLabel && <p className="text-xs font-bold">{statusLabel}</p>}
        {children}
      </div>
    )
    if (href) return <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{inner}</Link>
    if (onClick) return <button onClick={onClick} className="w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{inner}</button>
    return inner
  }

  // matrix variant: compact card for management dashboard
  const inner = (
    <div className={cn("relative flex h-[96px] w-[144px] flex-col rounded-[14px] p-2.5 shadow-sm transition-shadow hover:shadow-md", s.bg, className)}>
      <div className="flex items-start justify-between gap-1">
        <span className={cn("inline-flex rounded-full px-2 py-0.5 font-mono text-[12px] font-bold shadow-sm", s.badge)}>{roomNo}</span>
        {dateText && <span className={cn("text-[10px] font-medium", s.text)}>{dateText}</span>}
      </div>
      <div className="flex flex-1 items-center justify-center">
        <p className={cn("text-center text-[13px] font-bold leading-tight", s.text)}>{customerName || "可安排入住"}</p>
      </div>
      <div className="flex items-center justify-center gap-2">
        <ActionButton icon={Info} label="详情" />
        <ActionButton icon={ReceiptText} label="财务" />
        <ActionButton icon={ArrowRight} label="进入" />
      </div>
    </div>
  )
  if (href) return <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{inner}</Link>
  if (onClick) return <button onClick={onClick} className="w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{inner}</button>
  return inner
}
