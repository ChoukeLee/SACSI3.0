import { cn } from "@/lib/utils";

interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {}

export function FilterBar({ className, children, ...props }: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border border-brand-warm-200 bg-white p-3 shadow-card sm:flex-row",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function FilterSegmentButton({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-fast",
        active
          ? "bg-brand-indigo-500 text-white shadow-sm"
          : "border border-brand-warm-200 bg-white text-brand-ink-500 hover:bg-brand-warm-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
