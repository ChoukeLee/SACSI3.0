import { PackageOpen } from "lucide-react"
import { cn } from "@/lib/utils"

export function EmptyState({ icon, title, description, action, className }: {
  icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-5 py-8 text-center shadow-xs", className)}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">{icon ?? <PackageOpen className="h-4 w-4" />}</div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
