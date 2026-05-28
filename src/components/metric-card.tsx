import { cn } from "@/lib/utils"

const tones = { indigo: "bg-primary", green: "bg-[hsl(var(--success))]", amber: "bg-[hsl(var(--warning))]", red: "bg-destructive", cyan: "bg-[hsl(var(--status-cleaning))]", purple: "bg-[hsl(var(--status-leased))]", neutral: "bg-[hsl(var(--status-sold))]" } as const
export type MetricTone = keyof typeof tones

export function MetricCard({ title, value, caption, tone = "indigo", className }: {
  title: string; value: string; caption?: string; tone?: MetricTone; className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md", className)}>
      <div className={cn("h-[3px]", tones[tone])} />
      <div className="px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{title}</p>
        <p className="mt-1.5 text-xl font-bold tracking-tight tabular-nums">{value}</p>
        {caption && <p className="mt-1 text-xs text-muted-foreground/70">{caption}</p>}
      </div>
    </div>
  )
}
