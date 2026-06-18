import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "purple" | "sold" | "leased";

const toneClass: Record<Tone, { dot: string; icon: string; bg: string; ring: string }> = {
  neutral: { dot: "bg-foreground/70", icon: "text-foreground", bg: "bg-muted/60", ring: "ring-border" },
  blue: { dot: "bg-accentBlue-500", icon: "text-accentBlue-600", bg: "bg-accentBlue-50", ring: "ring-accentBlue-100" },
  green: { dot: "bg-accentGreen-500", icon: "text-accentGreen-600", bg: "bg-accentGreen-50", ring: "ring-accentGreen-100" },
  amber: { dot: "bg-accentAmber-500", icon: "text-accentAmber-600", bg: "bg-accentAmber-50", ring: "ring-accentAmber-100" },
  red: { dot: "bg-accentRed-500", icon: "text-accentRed-600", bg: "bg-accentRed-50", ring: "ring-accentRed-100" },
  purple: { dot: "bg-accentPurple-500", icon: "text-accentPurple-600", bg: "bg-accentPurple-50", ring: "ring-accentPurple-100" },
  sold: { dot: "bg-[#B88A48]", icon: "text-[#7B5A2B]", bg: "bg-[#EFE1CA]/70", ring: "ring-[#D8BF98]/70" },
  leased: { dot: "bg-[#5E9BC5]", icon: "text-[#2E6F9A]", bg: "bg-[#DDECF7]/70", ring: "ring-[#AFCBE1]/70" },
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
        "group flex min-h-[76px] items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left shadow-card transition-all duration-fast",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lifted",
        active && "border-foreground/30 bg-muted/30 ring-2 ring-foreground/5",
        className,
      )}
    >
      {Icon ? (
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1", t.bg, t.ring)}>
          <Icon className={cn("h-4 w-4", t.icon)} strokeWidth={1.8} />
        </span>
      ) : (
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", t.dot)} />
      )}
      <span className="min-w-0">
        <span className="block text-xl font-semibold leading-none tabular-nums text-foreground">{value}</span>
        <span className="mt-1 block text-[11px] font-medium leading-tight text-muted-foreground">{label}</span>
        {caption && <span className="mt-1 block text-[11px] leading-tight text-muted-foreground/80">{caption}</span>}
      </span>
    </Comp>
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
    <div className={cn("flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {meta && <div className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{meta}</div>}
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
    <nav className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted p-1 shadow-xs", className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors sm:px-4 sm:py-2 sm:text-sm",
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
  "h-9 rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/20";

