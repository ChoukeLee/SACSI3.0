import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const baseInputClass =
  "w-full rounded-lg border border-brand-warm-300 bg-white px-3 py-2 text-sm text-brand-ink-800 shadow-sm transition placeholder:text-brand-ink-400 hover:border-brand-indigo-300 focus:border-brand-indigo-500 focus:outline-none focus:ring-2 focus:ring-brand-indigo-500/20";

const sizes = {
  sm: "h-8 text-xs",
  md: "h-9 text-sm",
  lg: "h-10 text-sm",
} as const;

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: keyof typeof sizes;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, inputSize = "md", ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(baseInputClass, sizes[inputSize], className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  inputSize?: keyof typeof sizes;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, inputSize = "md", ...props }, ref) => {
    return (
      <select
        className={cn(baseInputClass, "appearance-none", sizes[inputSize], className)}
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
        className={cn(baseInputClass, "min-h-[80px]", className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { baseInputClass };
