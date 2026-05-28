import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-semibold ring-offset-background transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 select-none active:scale-[0.98]",
  {
    variants: {
      variant: {
        // shadcn standard
        default: "bg-brand-indigo-500 text-white shadow-sm hover:bg-brand-indigo-600",
        destructive: "bg-brand-red-500 text-white hover:bg-brand-red-600",
        outline: "border border-brand-warm-300 bg-white text-brand-ink-800 hover:bg-brand-indigo-50 hover:border-brand-indigo-200",
        secondary: "bg-brand-warm-100 text-brand-ink-800 hover:bg-brand-warm-200",
        ghost: "bg-transparent text-brand-ink-500 hover:bg-brand-indigo-50 hover:text-brand-indigo-700",
        link: "text-brand-indigo-600 underline-offset-4 hover:underline",
        // SACIS legacy (mapped for backward compat)
        primary: "bg-brand-indigo-500 text-white shadow-sm hover:bg-brand-indigo-600",
        accent: "bg-brand-indigo-50 text-brand-indigo-700 border border-brand-indigo-200 hover:bg-brand-indigo-100",
        danger: "bg-brand-red-500 text-white hover:bg-brand-red-600",
        "danger-secondary": "bg-white text-brand-red-600 border border-brand-red-200 hover:bg-brand-red-50",
        icon: "inline-flex items-center justify-center rounded-lg text-brand-ink-500 hover:bg-brand-indigo-50 hover:text-brand-indigo-700",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-[11px]",
        lg: "h-10 px-5",
        icon: "h-9 w-9",
        xs: "h-7 px-2 text-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
