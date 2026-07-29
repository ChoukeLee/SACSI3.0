"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, CalendarCheck, Clock, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import type { AlertIcon, AlertItem } from "./management-alerts";

interface AlertStripProps {
  alerts: AlertItem[];
  locale: Locale;
}

function AlertCard({ item }: { item: AlertItem }) {
  const icons = {
    alert: AlertTriangle,
    calendar: CalendarCheck,
    clock: Clock,
    "credit-card": CreditCard,
  } satisfies Record<AlertIcon, typeof AlertTriangle>;
  const Icon = icons[item.icon];
  const colors = {
    red:   "border-l-accentRed-500 bg-accentRed-50/60 hover:bg-accentRed-50",
    amber: "border-l-accentAmber-500 bg-accentAmber-50/60 hover:bg-accentAmber-50",
    blue:  "border-l-accentBlue-500 bg-accentBlue-50/60 hover:bg-accentBlue-50",
  };
  const textColors = {
    red:   "text-accentRed-700",
    amber: "text-accentAmber-700",
    blue:  "text-accentBlue-700",
  };
  const bgBadge = {
    red:   "bg-accentRed-100 text-accentRed-700",
    amber: "bg-accentAmber-100 text-accentAmber-700",
    blue:  "bg-accentBlue-100 text-accentBlue-700",
  };

  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-border/50 border-l-[3px] px-4 py-3 transition-all duration-200 hover:shadow-sm",
        colors[item.tone],
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", textColors[item.tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{item.label}</p>
        {item.detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>}
      </div>
      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold", bgBadge[item.tone])}>
        {item.count}
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function AlertStrip({ alerts, locale }: AlertStripProps) {
  if (alerts.length === 0) return null;
  const zh = locale === "zh";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Bell className="h-3.5 w-3.5" />
        <span>{zh ? "需要关注" : "À surveiller"}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {alerts.map((item) => (
          <AlertCard key={item.key} item={item} />
        ))}
      </div>
    </div>
  );
}
