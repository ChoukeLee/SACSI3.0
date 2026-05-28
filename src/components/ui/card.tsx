import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "subtle";
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingMap = {
  none: "",
  sm: "p-3",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-6",
} as const;

export function Card({ className, variant = "default", padding = "md", children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white shadow-card",
        paddingMap[padding],
        variant === "default" && "border-brand-warm-200",
        variant === "subtle" && "border-brand-warm-200 bg-brand-warm-50",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
