import { cn } from "@/lib/utils";

export const badgeVariants = {
  default: "bg-brand-neutral-100 text-brand-neutral-700 ring-brand-neutral-300/70",
  accent: "bg-brand-orange-50 text-brand-orange-700 ring-brand-orange-200",
  success: "bg-brand-green-50 text-brand-green-700 ring-brand-green-200",
  warning: "bg-brand-amber-50 text-brand-amber-700 ring-brand-amber-200",
  danger: "bg-brand-red-50 text-brand-red-700 ring-brand-red-200",
  info: "bg-brand-sky-50 text-brand-sky-700 ring-brand-sky-200",
  neutral: "bg-brand-neutral-200 text-brand-neutral-600 ring-brand-neutral-300",
  outline: "bg-white text-slate-600 ring-slate-300",
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
        size === "sm" && "px-2.5 py-0.5 text-[10px]",
        size === "md" && "px-3 py-1 text-[11px]",
        badgeVariants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
