import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

const tones: Record<string, { bg: string; icon: string; dot: string }> = {
  blue:     { bg: "bg-accentBlue-50/70",   icon: "text-accentBlue-600",   dot: "bg-accentBlue-500" },
  indigo:   { bg: "bg-accentBlue-50/70",   icon: "text-accentBlue-600",   dot: "bg-accentBlue-500" },
  green:    { bg: "bg-accentGreen-50/70",  icon: "text-accentGreen-600",  dot: "bg-accentGreen-500" },
  amber:    { bg: "bg-accentAmber-50/70",  icon: "text-accentAmber-600",  dot: "bg-accentAmber-500" },
  red:      { bg: "bg-accentRed-50/70",    icon: "text-accentRed-600",    dot: "bg-accentRed-500" },
  purple:   { bg: "bg-accentPurple-50/70", icon: "text-accentPurple-600", dot: "bg-accentPurple-500" },
  neutral:  { bg: "bg-muted/60",           icon: "text-foreground",        dot: "bg-foreground/60" },
  sold:     { bg: "bg-[#EFE1CA]/70",       icon: "text-[#7B5A2B]",         dot: "bg-[#B88A48]" },
  leased:   { bg: "bg-[#DDECF7]/70",       icon: "text-[#2E6F9A]",         dot: "bg-[#5E9BC5]" },
  available:{ bg: "bg-accentAmber-50/30",  icon: "text-accentAmber-600",  dot: "bg-[#F0E0D0]" },
  maintenance:{ bg: "bg-accentRed-50/50",  icon: "text-accentRed-600",    dot: "bg-[#F0A080]" },
}

export function MetricCard({
  title, value, caption, accent, tone, icon: Icon, onClick, className,
}: {
  title: string
  value: string
  caption?: string
  accent?: keyof typeof tones
  /** @deprecated use `accent` instead */
  tone?: keyof typeof tones
  icon?: LucideIcon
  onClick?: () => void
  className?: string
}) {
  const key = accent ?? tone ?? "neutral"
  const a = tones[key] ?? tones.neutral
  const Wrapper = onClick ? "button" : "div"

  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "group flex flex-col rounded-xl border border-border bg-card p-3.5 text-left text-card-foreground shadow-card transition-shadow duration-200",
        caption ? "min-h-[100px]" : "min-h-[84px]",
        onClick && "cursor-pointer hover:shadow-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
        className,
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 pb-2">
        <p className="min-w-0 truncate text-sm font-medium leading-tight tracking-tight text-foreground">{title}</p>
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {Icon ? <Icon className={cn("h-4 w-4", a.icon)} strokeWidth={1.75} /> : <span className={cn("h-2.5 w-2.5 rounded-full", a.dot)} />}
        </span>
      </div>
      <p className="text-lg font-semibold leading-none tabular-nums text-foreground">{value}</p>
      {caption && <p className="mt-2 min-h-5 text-xs leading-relaxed text-muted-foreground">{caption}</p>}
    </Wrapper>
  )
}
