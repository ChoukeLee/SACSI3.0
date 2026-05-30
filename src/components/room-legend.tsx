import { cn } from "@/lib/utils"

export interface LegendItem {
  key: string
  label: string
  color: string
}

interface Props {
  items: LegendItem[]
  className?: string
  compact?: boolean
}

export function RoomLegend({ items, className, compact }: Props) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {items.map(item => (
        <span key={item.key} className={cn(
          "inline-flex items-center gap-1 text-[#5D7186]",
          compact ? "text-[10px]" : "text-[11px]",
        )}>
          <span className={cn("rounded-full shrink-0", compact ? "h-1.5 w-1.5" : "h-2 w-2")} style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
