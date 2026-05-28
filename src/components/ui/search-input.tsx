import * as React from "react"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  inputSize?: "sm" | "md"
}

export function SearchInput({ className, inputSize = "md", ...props }: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input type="text" className={cn(
        "flex w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
        inputSize === "sm" ? "h-8 pl-9 text-xs" : "h-9 pl-9"
      )} {...props} />
    </div>
  )
}
