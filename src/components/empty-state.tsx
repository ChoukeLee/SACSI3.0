import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-brand-warm-300 bg-white py-16 text-center shadow-natural", className)}>
      {icon && <div className="text-brand-ink-200">{icon}</div>}
      <p className="text-sm font-medium text-brand-ink-400">{title}</p>
      {description && <p className="text-xs text-brand-ink-300 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}
