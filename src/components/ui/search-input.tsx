import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  inputSize?: "sm" | "md";
}

export function SearchInput({ className, inputSize = "md", ...props }: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink-400" />
      <input
        type="text"
        className={cn(
          "w-full rounded-lg border border-brand-warm-300 bg-white text-brand-ink-800 shadow-sm transition placeholder:text-brand-ink-400 hover:border-brand-indigo-300 focus:border-brand-indigo-500 focus:outline-none focus:ring-2 focus:ring-brand-indigo-500/20",
          inputSize === "sm" ? "h-8 pl-9 pr-3 text-xs" : "h-9 pl-9 pr-3 text-sm",
        )}
        {...props}
      />
    </div>
  );
}
