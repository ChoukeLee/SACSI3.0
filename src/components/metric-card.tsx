import { cn } from "@/lib/utils"

const tones: Record<string, string> = {
  indigo: "bg-brand-indigo-500",
  green: "bg-brand-green-500",
  amber: "bg-brand-amber-500",
  red: "bg-brand-red-500",
  neutral: "bg-stone-500",
  sold: "bg-[#505080]",
  leased: "bg-[#7050A0]",
  available: "bg-[#F0E0D0]",
  maintenance: "bg-[#F0A080]",
}

export function MetricCard({ title, value, caption, tone = "indigo", onClick, className }: {
  title: string; value: string; caption?: string; tone?: keyof typeof tones; onClick?: () => void; className?: string
}) {
  const Wrapper = onClick ? "button" : "div"
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all duration-200",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md",
        className,
      )}
    >
      <div className={cn("h-[3px]", tones[tone])} />
      <div className="px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{title}</p>
        <p className="mt-1.5 text-xl font-bold tracking-tight tabular-nums">{value}</p>
        {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
      </div>
    </Wrapper>
  )
}
