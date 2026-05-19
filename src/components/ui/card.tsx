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
        "rounded-xl border bg-white shadow-card",
        paddingMap[padding],
        variant === "default" && "border-brand-warm-400",
        variant === "subtle" && "border-brand-warm-400 bg-brand-warm-50",
        variant === "dashed" && "border-dashed border-brand-warm-500 bg-brand-warm-50",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
