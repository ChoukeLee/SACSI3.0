"use client"

import Link from "next/link"
import { Info, ReceiptText, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type RoomStatus = "sold" | "leased" | "daily_occupied" | "reserved" | "cleaning_pending" | "maintenance" | "available"

const statusStyle: Record<RoomStatus, { bg: string; badge: string; text: string }> = {
  sold:            { bg: "bg-[#EDE8E3]", badge: "bg-white/80 text-[#5C554F]", text: "text-[#5C554F]" },
  leased:          { bg: "bg-[#FEF0E0]", badge: "bg-white/80 text-[#7D5E2E]", text: "text-[#7D5E2E]" },
  daily_occupied:  { bg: "bg-[#FFF1EB]", badge: "bg-white/80 text-[#9B3D1C]", text: "text-[#9B3D1C]" },
  reserved:        { bg: "bg-[#EEF4FA]", badge: "bg-white/80 text-[#3C6080]", text: "text-[#3C6080]" },
  cleaning_pending:{ bg: "bg-[#EDF7F5]", badge: "bg-white/80 text-[#2D6B60]", text: "text-[#2D6B60]" },
  maintenance:     { bg: "bg-[#FBEDED]", badge: "bg-white/80 text-[#8B3535]", text: "text-[#8B3535]" },
  available:       { bg: "bg-[#EDF5ED]", badge: "bg-white/80 text-[#356B35]", text: "text-[#356B35]" },
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
  const s = statusStyle[status]

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
