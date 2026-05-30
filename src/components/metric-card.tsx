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
  sold:     { bg: "bg-muted/60",           icon: "text-foreground",        dot: "bg-[#505080]" },
  leased:   { bg: "bg-accentPurple-50/70", icon: "text-accentPurple-600", dot: "bg-[#7050A0]" },
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
        "group relative flex items-start gap-4 rounded-xl border border-border/70 bg-card p-5 text-left shadow-sm transition-all duration-fast",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:shadow-lifted",
        className,
      )}
    >
      {Icon && (
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", a.bg)}>
          <Icon className={cn("h-5 w-5", a.icon)} strokeWidth={1.75} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className="mt-1 text-xl font-bold tracking-tight tabular-nums">{value}</p>
        {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
      </div>
      {onClick && (
        <div className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full opacity-0 transition-opacity group-hover:opacity-100", a.dot)} />
      )}
    </Wrapper>
  )
}
