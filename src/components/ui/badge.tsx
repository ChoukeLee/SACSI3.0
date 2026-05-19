import { cn } from "@/lib/utils";

export const badgeVariants = {
  default: "bg-brand-warm-100 text-brand-ink-600 ring-brand-warm-400/30",
  accent: "bg-brand-orange-50 text-brand-orange-700 ring-brand-orange-200/50",
  success: "bg-brand-green-50 text-brand-green-700 ring-brand-green-200/50",
  warning: "bg-brand-amber-50 text-brand-amber-700 ring-brand-amber-200/50",
  danger: "bg-brand-red-50 text-brand-red-700 ring-brand-red-200/50",
  info: "bg-brand-sky-50 text-brand-sky-700 ring-brand-sky-200/50",
  neutral: "bg-brand-warm-200 text-brand-ink-500 ring-brand-warm-400/40",
  outline: "bg-transparent text-brand-ink-600 ring-brand-warm-400/60",
} as const;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof badgeVariants;
  size?: "sm" | "md";
}

export function Badge({ className, variant = "default", size = "sm", children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md font-medium ring-1 ring-inset",
        size === "sm" && "px-2 py-0.5 text-[10px]",
        size === "md" && "px-2.5 py-0.5 text-[11px]",
        badgeVariants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
