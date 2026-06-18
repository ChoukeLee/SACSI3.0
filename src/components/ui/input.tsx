import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, type, ...props }, ref) => (
  <input type={type} className={cn(
    "flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-xs transition-all duration-fast file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/55 hover:border-border/90 focus-visible:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
    className
  )} ref={ref} {...props} />
))
Input.displayName = "Input"
export { Input }
