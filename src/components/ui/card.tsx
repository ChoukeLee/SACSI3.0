import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "subtle" | "dashed";
  padding?: "none" | "sm" | "md" | "lg";
}

export function Card({ className, variant = "default", padding = "md", children, ...props }: CardProps) {
  const paddingMap: Record<string, string> = {
    none: "",
    sm: "p-3",
    md: "p-4 sm:p-5",
    lg: "p-5 sm:p-6",
  };

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white shadow-natural",
        paddingMap[padding],
        variant === "default" && "border-slate-200",
        variant === "subtle" && "border-slate-200 bg-slate-50/80",
        variant === "dashed" && "border-dashed border-slate-300 bg-slate-50/70",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
