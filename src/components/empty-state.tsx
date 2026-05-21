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
    <div className={cn("flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white py-16 text-center shadow-natural", className)}>
      {icon && <div className="text-slate-300">{icon}</div>}
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      {description && <p className="max-w-sm text-xs font-semibold text-slate-400">{description}</p>}
      {action}
    </div>
  );
}
