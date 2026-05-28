import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const variantStyles = {
  primary:
    "bg-brand-indigo-500 text-white shadow-sm hover:bg-brand-indigo-600 active:bg-brand-indigo-700 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo disabled:bg-brand-indigo-200 disabled:text-white/80 disabled:scale-100",
  secondary:
    "bg-white text-brand-ink-900 border border-brand-warm-300 shadow-sm hover:bg-brand-indigo-50 hover:border-brand-indigo-200 active:bg-brand-indigo-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo disabled:border-brand-warm-200 disabled:text-brand-neutral-500 disabled:scale-100",
  outline:
    "bg-white text-brand-ink-900 border border-brand-warm-300 hover:bg-brand-indigo-50 hover:border-brand-indigo-200 active:bg-brand-indigo-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo disabled:border-brand-warm-200 disabled:text-brand-neutral-500 disabled:scale-100",
  ghost:
    "bg-transparent text-brand-ink-800 hover:bg-brand-indigo-50 hover:text-brand-indigo-800 active:bg-brand-indigo-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo disabled:text-brand-neutral-500 disabled:scale-100",
  accent:
    "bg-brand-indigo-50 text-brand-indigo-800 border border-brand-indigo-200 hover:bg-brand-indigo-100 hover:border-brand-indigo-300 active:bg-brand-indigo-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo disabled:opacity-40 disabled:scale-100",
  danger:
    "bg-brand-red-500 text-white hover:bg-brand-red-600 active:bg-brand-red-700 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red-500 disabled:bg-brand-red-300 disabled:scale-100",
  "danger-secondary":
    "bg-white text-brand-red-600 border border-brand-red-200 hover:bg-brand-red-50 hover:border-brand-red-300 active:bg-brand-red-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red-500 disabled:border-brand-red-100 disabled:text-brand-red-300 disabled:scale-100",
  icon: "inline-flex items-center justify-center rounded-lg text-brand-neutral-700 hover:bg-brand-indigo-50 hover:text-brand-indigo-700 active:bg-brand-indigo-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-indigo disabled:text-brand-neutral-500 disabled:scale-100",
} as const;

const sizeStyles = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-9 px-4 text-xs gap-2 rounded-lg",
  lg: "h-10 px-5 text-xs gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-lg",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantStyles;
  size?: keyof typeof sizeStyles;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, loading, children, type, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex items-center justify-center font-semibold select-none",
          "transition-colors duration-fast",
          variantStyles[variant],
          sizeStyles[size],
          variant === "icon" ? "shrink-0" : "",
          className
        )}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
