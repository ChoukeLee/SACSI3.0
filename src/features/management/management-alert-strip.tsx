"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, CalendarCheck, Clock, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatXof } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";

interface AlertItem {
  key: string;
  label: string;
  count: number;
  detail?: string;
  href: string;
  /** red=urgent, amber=attention, blue=info */
  tone: "red" | "amber" | "blue";
  icon: typeof AlertTriangle;
}

interface AlertStripProps {
  alerts: AlertItem[];
  locale: Locale;
}

function AlertCard({ item }: { item: AlertItem }) {
  const Icon = item.icon;
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

/** Compute alerts from live data — call this from the dashboard page. */
export function computeAlerts(params: {
  overdueCount: number;
  overdueTotal: number;
  todayCheckouts: number;
  todayCheckins: number;
  expiringLeases: number;
  pendingReviewBookings: number;
  locale: Locale;
}): AlertItem[] {
  const zh = params.locale === "zh";
  const alerts: AlertItem[] = [];

  if (params.overdueCount > 0) {
    alerts.push({
      key: "overdue",
      label: zh ? "逾期欠款" : "Impayés",
      count: params.overdueCount,
      detail: zh ? `合计 ${formatXof(params.overdueTotal)}` : `Total ${formatXof(params.overdueTotal)}`,
      href: "/reports",
      tone: "red",
      icon: AlertTriangle,
    });
  }

  if (params.todayCheckouts > 0) {
    alerts.push({
      key: "checkouts",
      label: zh ? "今日退房" : "Départs",
      count: params.todayCheckouts,
      href: "/daily-rentals",
      tone: "amber",
      icon: CalendarCheck,
    });
  }

  if (params.todayCheckins > 0) {
    alerts.push({
      key: "checkins",
      label: zh ? "今日入住" : "Arrivées",
      count: params.todayCheckins,
      href: "/daily-rentals",
      tone: "blue",
      icon: Clock,
    });
  }

  if (params.pendingReviewBookings > 0) {
    alerts.push({
      key: "pending",
      label: zh ? "待确认预订" : "À confirmer",
      count: params.pendingReviewBookings,
      href: "/daily-rentals",
      tone: "amber",
      icon: CalendarCheck,
    });
  }

  if (params.expiringLeases > 0) {
    alerts.push({
      key: "expiring",
      label: zh ? "30天内到期合同" : "Expire sous 30j",
      count: params.expiringLeases,
      href: "/leases",
      tone: "blue",
      icon: CreditCard,
    });
  }

  return alerts;
}
