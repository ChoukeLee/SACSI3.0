import { cn } from "@/lib/utils";

export const badgeVariants = {
  default: "bg-white text-brand-ink-900 ring-brand-warm-300",
  accent: "bg-brand-indigo-50 text-brand-indigo-800 ring-brand-indigo-200",
  success: "bg-brand-green-50 text-brand-green-800 ring-brand-green-200",
  warning: "bg-brand-amber-50 text-brand-amber-800 ring-brand-amber-200",
  danger: "bg-brand-red-50 text-brand-red-800 ring-brand-red-200",
  info: "bg-brand-cyan-50 text-brand-cyan-800 ring-brand-cyan-200",
  neutral: "bg-brand-warm-100 text-brand-ink-700 ring-brand-warm-300",
  outline: "bg-white text-brand-ink-800 ring-brand-warm-300",
} as const;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof badgeVariants;
  size?: "sm" | "md";
}

export function Badge({ className, variant = "default", size = "sm", children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-bold ring-1 ring-inset",
        size === "sm" && "px-2.5 py-0.5 text-xs",
        size === "md" && "px-3 py-1 text-xs",
        badgeVariants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
