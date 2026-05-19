import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const variantStyles = {
  primary:
    "bg-brand-ink-900 text-white hover:bg-brand-ink-700 active:bg-brand-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:bg-brand-ink-400 disabled:text-brand-ink-200",
  secondary:
    "bg-white text-brand-ink-700 border border-brand-warm-500 hover:bg-brand-warm-100 hover:border-brand-warm-600 active:bg-brand-warm-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:border-brand-warm-300 disabled:text-brand-ink-300",
  outline:
    "bg-transparent text-brand-ink-700 border border-brand-warm-500 hover:bg-brand-warm-100 hover:border-brand-warm-600 active:bg-brand-warm-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:border-brand-warm-300 disabled:text-brand-ink-300",
  ghost:
    "bg-transparent text-brand-ink-600 hover:bg-brand-warm-100 active:bg-brand-warm-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:text-brand-ink-300",
  accent:
    "bg-brand-orange-50 text-brand-orange-700 border border-brand-orange-200 hover:bg-brand-orange-100 hover:border-brand-orange-300 active:bg-brand-orange-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-40",
  danger:
    "bg-brand-red-500 text-white hover:bg-brand-red-600 active:bg-brand-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red-500 disabled:bg-brand-red-300",
  "danger-secondary":
    "bg-white text-brand-red-600 border border-brand-red-200 hover:bg-brand-red-50 hover:border-brand-red-300 active:bg-brand-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red-500 disabled:border-brand-red-100 disabled:text-brand-red-300",
  icon: "inline-flex items-center justify-center rounded-lg text-brand-ink-400 hover:bg-brand-warm-100 hover:text-brand-ink-600 active:bg-brand-warm-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:text-brand-ink-200",
} as const;

const sizeStyles = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-9 px-4 text-sm gap-2 rounded-lg",
  lg: "h-10 px-5 text-sm gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-lg",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantStyles;
  size?: keyof typeof sizeStyles;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center font-semibold select-none",
          "transition-colors duration-[100ms]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "active:scale-[0.98]",
          variantStyles[variant],
          sizeStyles[size],
          variant === "icon" ? "shrink-0" : "",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
