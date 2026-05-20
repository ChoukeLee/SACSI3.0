import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const variantStyles = {
  primary:
    "bg-slate-950 text-white shadow-sm hover:bg-slate-800 active:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:bg-slate-400 disabled:text-slate-200",
  secondary:
    "bg-white text-slate-700 border border-slate-200 shadow-sm hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:border-slate-200 disabled:text-slate-300",
  outline:
    "bg-white/60 text-slate-700 border border-slate-200 hover:bg-white hover:border-slate-300 active:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:border-slate-200 disabled:text-slate-300",
  ghost:
    "bg-transparent text-slate-600 hover:bg-slate-100 active:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:text-slate-300",
  accent:
    "bg-brand-orange-50 text-brand-orange-700 border border-brand-orange-200 hover:bg-brand-orange-100 hover:border-brand-orange-300 active:bg-brand-orange-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-40",
  danger:
    "bg-brand-red-500 text-white hover:bg-brand-red-600 active:bg-brand-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red-500 disabled:bg-brand-red-300",
  "danger-secondary":
    "bg-white text-brand-red-600 border border-brand-red-200 hover:bg-brand-red-50 hover:border-brand-red-300 active:bg-brand-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red-500 disabled:border-brand-red-100 disabled:text-brand-red-300",
  icon: "inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:text-slate-200",
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
