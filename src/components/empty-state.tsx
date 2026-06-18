import { PackageOpen } from "lucide-react"
import { cn } from "@/lib/utils"

export function EmptyState({ icon, title, description, action, className }: {
  icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center shadow-card", className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">{icon ?? <PackageOpen className="h-5 w-5" />}</div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground/70">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
