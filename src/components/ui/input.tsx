import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const baseInputClass =
  "w-full rounded-lg border bg-white px-3 py-2 text-sm text-brand-ink-900 placeholder:text-brand-ink-300 transition-all duration-fast hover:border-brand-warm-500 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30 focus:border-brand-orange";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(baseInputClass, "border-brand-warm-400", className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(baseInputClass, "border-brand-warm-400 appearance-none", className)}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(baseInputClass, "border-brand-warm-400", className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { baseInputClass };
