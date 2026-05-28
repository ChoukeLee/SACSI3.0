import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const baseInputClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-brand-neutral-950 shadow-sm transition placeholder:text-brand-neutral-700 hover:border-brand-indigo-200 hover:bg-brand-indigo-50/40 focus:border-brand-indigo-300 focus:outline-none focus:ring-2 focus:ring-brand-indigo-500/15";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(baseInputClass, className)}
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
        className={cn(baseInputClass, "appearance-none", className)}
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
        className={cn(baseInputClass, className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { baseInputClass };
