import { PackageOpen } from "lucide-react"
import { cn } from "@/lib/utils"

export function EmptyState({ icon, title, description, action, className }: {
  icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-border bg-card py-16 text-center shadow-sm", className)}>
      <div className="text-muted-foreground/60">{icon ?? <PackageOpen className="h-10 w-10" />}</div>
      <p className="text-sm font-semibold text-muted-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground/70">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
