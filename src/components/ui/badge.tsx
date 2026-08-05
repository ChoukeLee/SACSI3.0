import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-border bg-muted text-secondary-foreground",
        destructive: "border-accentRed-100 bg-accentRed-50 text-accentRed-700",
        outline: "border-border bg-card text-foreground",
        success: "border-accentGreen-100 bg-accentGreen-50 text-accentGreen-700",
        warning: "border-accentAmber-100 bg-accentAmber-50 text-accentAmber-700",
        info: "border-accentBlue-100 bg-accentBlue-50 text-accentBlue-700",
        purple: "border-border bg-muted text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}
function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
export { Badge, badgeVariants }
