import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-brand-warm-300 bg-white px-3 py-2 text-sm text-brand-ink-800 shadow-sm transition placeholder:text-brand-ink-400 file:border-0 file:bg-transparent file:text-sm file:font-medium hover:border-brand-indigo-300 focus:border-brand-indigo-500 focus:outline-none focus:ring-2 focus:ring-brand-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
