import * as React from "react";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "purple" | "teal" | "sold" | "leased";

const toneClass: Record<Tone, { dot: string; icon: string }> = {
  neutral: { dot: "bg-foreground/65", icon: "text-muted-foreground" },
  blue: { dot: "bg-accentBlue-500", icon: "text-accentBlue-600" },
  green: { dot: "bg-accentGreen-500", icon: "text-accentGreen-600" },
  amber: { dot: "bg-accentAmber-500", icon: "text-accentAmber-600" },
  red: { dot: "bg-accentRed-500", icon: "text-accentRed-600" },
  purple: { dot: "bg-accentPurple-500", icon: "text-accentPurple-600" },
  teal: { dot: "bg-[#5CC4B8]", icon: "text-[#217365]" },
  sold: { dot: "bg-[#B88A48]", icon: "text-[#7B5A2B]" },
  leased: { dot: "bg-[#5E9BC5]", icon: "text-[#2E6F9A]" },
};

export function StatTile({
  label,
  value,
  caption,
  tone = "neutral",
  icon: Icon,
  active,
  onClick,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const t = toneClass[tone];
  const Comp = onClick ? "button" : "div";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "group flex flex-col rounded-xl border border-border bg-card p-3.5 text-left text-card-foreground shadow-card transition-shadow duration-200",
        caption ? "min-h-[100px]" : "min-h-[84px]",
        onClick && "cursor-pointer hover:shadow-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
        active && "border-foreground/25 ring-2 ring-foreground/10",
        className,
      )}
    >
      <span className="flex min-w-0 items-center justify-between gap-3 pb-2">
        <span className="min-w-0 truncate text-sm font-medium leading-tight tracking-tight text-foreground">{label}</span>
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {Icon ? (
            <Icon className={cn("h-4 w-4", t.icon)} strokeWidth={1.8} />
          ) : (
            <span className={cn("h-2.5 w-2.5 rounded-full", t.dot)} />
          )}
        </span>
      </span>
      <span className="block text-lg font-semibold leading-none tabular-nums text-foreground">{value}</span>
      {caption && <span className="mt-2 block min-h-5 text-xs leading-relaxed text-muted-foreground">{caption}</span>}
    </Comp>
  );
}

export function OperationalPage({
  eyebrow,
  title,
  description,
  action,
  children,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <section className="rounded-xl border border-border bg-card px-5 py-4 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {eyebrow && <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>}
            <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-normal text-foreground">{title}</h1>
            {description && <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </div>
      </section>
      {children}
    </div>
  );
}

export function MetricGrid({
  children,
  columns = 5,
  className,
}: {
  children: React.ReactNode;
  columns?: 3 | 4 | 5 | 6;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2",
        columns === 3 && "xl:grid-cols-3",
        columns === 4 && "xl:grid-cols-4",
        columns === 5 && "lg:grid-cols-3 xl:grid-cols-5",
        columns === 6 && "lg:grid-cols-3 xl:grid-cols-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function RightDrawer({
  open,
  title,
  subtitle,
  badge,
  actions,
  onClose,
  children,
  footer,
  width = "standard",
  className,
}: {
  open: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "compact" | "standard" | "wide" | "table";
  className?: string;
}) {
  if (!open) return null;
  const widthClass = {
    compact: "lg:max-w-[420px]",
    standard: "lg:max-w-[480px]",
    wide: "lg:max-w-[560px]",
    table: "lg:max-w-5xl",
  }[width];

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 top-12 z-overlay bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <aside
        className={cn(
          "fixed bottom-0 right-0 top-12 z-panel flex w-full max-w-full flex-col border-l border-border bg-card shadow-panel",
          widthClass,
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
      >
        <div className="sticky top-0 z-10 flex min-h-16 items-start justify-between gap-4 border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[15px] font-semibold leading-6 text-foreground">{title}</h2>
              {badge}
            </div>
            {subtitle && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5">{children}</div>
        {footer && <div className="sticky bottom-0 border-t border-border bg-card/95 px-5 py-4 backdrop-blur">{footer}</div>}
      </aside>
    </>
  );
}

export function FilterBar({
  children,
  meta,
  className,
}: {
  children: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex max-w-full flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {meta && <div className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{meta}</div>}
    </div>
  );
}

export function FilterGroup({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  items: { value: T; label: React.ReactNode; count?: React.ReactNode }[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <nav className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-muted/70 p-1 shadow-xs", className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === item.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-card hover:text-foreground",
          )}
        >
          {item.label}
          {item.count != null && <span className="ml-1 tabular-nums opacity-75">{item.count}</span>}
        </button>
      ))}
    </nav>
  );
}

export const controlClass =
  "h-9 rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium shadow-xs outline-offset-2 transition-colors placeholder:text-muted-foreground hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60";
