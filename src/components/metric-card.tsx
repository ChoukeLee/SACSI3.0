import { cn } from "@/lib/utils"

const tones: Record<string, string> = {
  orange: "bg-primary",
  green: "bg-emerald-600",
  amber: "bg-amber-600",
  red: "bg-destructive",
  neutral: "bg-stone-500",
}

export function MetricCard({ title, value, caption, tone = "orange", onClick, className }: {
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
