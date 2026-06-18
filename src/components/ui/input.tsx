import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, type, ...props }, ref) => (
  <input type={type} className={cn(
    "flex h-9 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-xs outline-offset-2 transition-colors duration-fast file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/55 hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60",
    className
  )} ref={ref} {...props} />
))
Input.displayName = "Input"
export { Input }
