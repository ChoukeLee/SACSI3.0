"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import { Info, ReceiptText, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type RoomStatus =
  | "sold"
  | "managed"
  | "leased"
  | "daily_occupied"
  | "dailyOccupied"
  | "reserved"
  | "cleaning_pending"
  | "cleaningPending"
  | "maintenance"
  | "ownerOccupied"
  | "available"

export interface RoomCardAction {
  key: string
  label: string
  icon: LucideIcon
  href?: string
  onClick?: (e: React.MouseEvent) => void
  disabled?: boolean
}

/* ── Status → color mapping ── */
type CardColors = { bg: string; badge: string; nameColor: string; metaColor: string; btnBg: string };
const statusStyle: Record<RoomStatus, CardColors> = {
  sold:            { bg: "bg-[#D7F0FF]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#4D6780]",                    btnBg: "bg-white/[0.90]" },
  managed:         { bg: "bg-[#B7EBDD]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#456F67]",                    btnBg: "bg-white/[0.90]" },
  leased:          { bg: "bg-[#C9D3DE]", badge: "bg-white text-[#17324D]", nameColor: "text-[#17324D]", metaColor: "text-[#465B6D]", btnBg: "bg-white/[0.92]" },
  daily_occupied:  { bg: "bg-[#58AEEF]", badge: "bg-white/[0.94] text-[#17324D]", nameColor: "text-[rgba(255,255,255,0.98)]", metaColor: "text-[rgba(255,255,255,0.78)]", btnBg: "bg-white/[0.84]" },
  dailyOccupied:   { bg: "bg-[#58AEEF]", badge: "bg-white/[0.94] text-[#17324D]", nameColor: "text-[rgba(255,255,255,0.98)]", metaColor: "text-[rgba(255,255,255,0.78)]", btnBg: "bg-white/[0.84]" },
  reserved:        { bg: "bg-[#FFE8A6]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#735F24]",                    btnBg: "bg-white/[0.90]" },
  cleaning_pending:{ bg: "bg-[#BFEFE6]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#456F67]",                    btnBg: "bg-white/[0.90]" },
  cleaningPending: { bg: "bg-[#BFEFE6]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#456F67]",                    btnBg: "bg-white/[0.90]" },
  maintenance:     { bg: "bg-[#FFC9D5]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#7A5360]",                    btnBg: "bg-white/[0.90]" },
  ownerOccupied:   { bg: "bg-[#E2DFD8]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#62615D]",                    btnBg: "bg-white/[0.90]" },
  available:       { bg: "bg-[#E7CD9A]", badge: "bg-white text-[#17324D]",        nameColor: "text-[#17324D]",                   metaColor: "text-[#6F552D]",                    btnBg: "bg-white/[0.90]" },
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
  actions?: RoomCardAction[]
}

const DEFAULT_ACTIONS: RoomCardAction[] = [
  { key: "detail", label: "详情", icon: Info },
  { key: "finance", label: "财务", icon: ReceiptText },
  { key: "enter", label: "进入", icon: ArrowRight },
]

/* ── 30×30 action button ── */
function ActionBtn({ action, btnBg }: { action: RoomCardAction; btnBg: string }) {
  const router = useRouter()
  const inner = (
    <span
      className={cn(
        "inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[rgba(23,50,77,0.08)] shadow-[0_1px_2px_rgba(25,58,92,0.05)] transition-all",
        btnBg,
        action.disabled
          ? "opacity-40 cursor-not-allowed"
          : "hover:bg-white/[0.96] hover:-translate-y-px hover:shadow-[0_2px_4px_rgba(25,58,92,0.08)] cursor-pointer",
      )}
      aria-label={action.label}
      title={action.label}
    >
      <action.icon className="h-[15px] w-[15px] text-[rgba(23,50,77,0.76)]" strokeWidth={1.5} />
    </span>
  )

  if (action.disabled) return inner
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (action.onClick) { action.onClick(e) }
    else if (action.href) { router.push(action.href) }
  }
  return <button type="button" onClick={handleClick} className="contents">{inner}</button>
}

export function RoomCard({ roomNo, status, statusLabel, customerName, dateText, href, onClick, className, children, actions }: Props) {
  const s = statusStyle[status] ?? statusStyle.available
  const btns = (actions ?? DEFAULT_ACTIONS).slice(0, 3)

  /* ── Detail variant (leases / sales) ── */
  if (children) {
    const inner = (
      <div className={cn(
        "flex h-full min-h-[236px] flex-col gap-3 rounded-lg border border-[rgba(23,50,77,0.08)] p-4 shadow-[0_8px_18px_rgba(25,58,92,0.08)]",
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
      "relative h-[106px] w-full rounded-[10px] border border-[rgba(23,50,77,0.08)] shadow-[0_8px_18px_rgba(25,58,92,0.08)]",
      "font-[\"Segoe_UI\",\"PingFang_SC\",\"Microsoft_YaHei\",system-ui,sans-serif]",
      s.bg, className,
    )}>
      <span className={cn(
        "absolute top-[11px] left-3 inline-flex h-[24px] min-w-[42px] items-center justify-center rounded-full px-[9px] text-center text-[13px] font-bold leading-[24px]",
        "shadow-[0_1px_2px_rgba(25,58,92,0.06)]",
        s.badge,
      )}>
        {roomNo}
      </span>

      {/* Right info group — primary on top, meta below */}
      <div className="absolute top-[16px] right-[14px] left-[68px] overflow-hidden text-right">
        <p className={cn("text-[14px] font-medium leading-[1.15] tracking-[0] truncate", s.nameColor)}>
          {customerName || "—"}
        </p>
        {dateText && (
          <p className={cn("mt-[5px] text-[12px] font-medium leading-[1.1] tracking-[0] truncate opacity-[0.78]", s.metaColor)}>
            {dateText}
          </p>
        )}
      </div>

      {/* Action buttons — 30×30, gap 16px */}
      <div className="absolute inset-x-0 bottom-[14px] flex items-center justify-center gap-4">
        {btns.map(a => <ActionBtn key={a.key} action={a} btnBg={s.btnBg} />)}
      </div>
    </div>
  )
  if (href) return <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{inner}</Link>
  if (onClick) return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }} className="block cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{inner}</div>
  return inner
}
