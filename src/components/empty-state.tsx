import { cn } from "@/lib/utils";
import { PackageOpen } from "lucide-react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-brand-warm-200 bg-white py-16 text-center shadow-card", className)}>
      <div className="text-brand-ink-300">
        {icon ?? <PackageOpen className="h-10 w-10" />}
      </div>
      <p className="text-sm font-semibold text-brand-ink-500">{title}</p>
      {description && <p className="max-w-sm text-sm text-brand-ink-400">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
