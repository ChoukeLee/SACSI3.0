import type { Locale } from "@/lib/i18n";
import { formatXof } from "@/lib/utils";

export type AlertIcon = "alert" | "calendar" | "clock" | "credit-card";

export interface AlertItem {
  key: string;
  label: string;
  count: number;
  detail?: string;
  href: string;
  tone: "red" | "amber" | "blue";
  icon: AlertIcon;
}

export function computeAlerts(params: {
  overdueCount: number;
  overdueTotal: number;
  todayCheckouts: number;
  todayCheckins: number;
  expiringLeases: number;
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
      href: "/management#finance",
      tone: "red",
      icon: "alert",
    });
  }

  if (params.todayCheckouts > 0) {
    alerts.push({
      key: "checkouts",
      label: zh ? "今日退房" : "Départs",
      count: params.todayCheckouts,
      href: "/daily-rentals",
      tone: "amber",
      icon: "calendar",
    });
  }

  if (params.todayCheckins > 0) {
    alerts.push({
      key: "checkins",
      label: zh ? "今日入住" : "Arrivées",
      count: params.todayCheckins,
      href: "/daily-rentals",
      tone: "blue",
      icon: "clock",
    });
  }

  if (params.expiringLeases > 0) {
    alerts.push({
      key: "expiring",
      label: zh ? "30天内到期合同" : "Expire sous 30j",
      count: params.expiringLeases,
      href: "/leases",
      tone: "blue",
      icon: "credit-card",
    });
  }

  return alerts;
}
