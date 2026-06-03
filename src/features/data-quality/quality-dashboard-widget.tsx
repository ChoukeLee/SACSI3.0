"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, ShieldAlert } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { QualityIssue } from "./quality-types";

interface Props {
  issues: QualityIssue[];
  locale: Locale;
  variant?: "dashboard" | "management";
}

export function QualityDashboardWidget({ issues, locale, variant = "dashboard" }: Props) {
  const high = issues.filter(i => i.severity === "high");
  const finance = issues.filter(i => i.category === "finance");
  const unit = issues.filter(i => i.category === "unit");

  if (variant === "dashboard") {
    if (issues.length === 0) return null;
    const top = issues.slice(0, 5);
    return (
      <div className="overflow-x-auto rounded-2xl border border-border/70 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/50 px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
            <ShieldAlert className="h-4 w-4 text-accentBlue-600" />
            {locale === "zh" ? "数据异常" : "Anomalies"}
          </h3>
          <span className={cn("text-xs font-semibold", high.length > 0 ? "text-accentRed-600" : "text-accentGreen-600")}>
            {high.length > 0 ? `${high.length} ${locale === "zh" ? "条高危" : "elevees"}` : (locale === "zh" ? "无高危" : "OK")}
          </span>
        </div>
        <div className="divide-y divide-border/50">
          {top.map(i => (
            <Link
              key={i.id}
              href={routeFor(locale, "/data-quality")}
              className="flex items-center gap-2 px-5 py-2 text-xs transition-colors hover:bg-accentBlue-50/50"
            >
              <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", i.severity === "high" ? "text-accentRed-500" : "text-accentBlue-600-500")} />
              <span className="flex-1 truncate text-foreground">{i.title}</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-white px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl",
            high.length > 0 ? "bg-accentRed-50 text-accentRed-600" : "bg-accentGreen-50 text-accentGreen-700",
          )}>
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-black text-foreground">{locale === "zh" ? "数据健康" : "Sante donnees"}</h3>
            <p className="mt-0.5 text-xs font-medium text-foreground/80">
              {locale === "zh" ? "自动扫描财务、房态和基础资料异常" : "Controle automatique finance, logements et donnees de base"}
            </p>
          </div>
        </div>
        <Link
          href={routeFor(locale, "/data-quality")}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-primary/90"
        >
          {locale === "zh" ? "查看全部" : "Voir tout"} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="bg-muted/40 px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QualityMetric label={locale === "zh" ? "异常总数" : "Total anomalies"} value={issues.length} tone={issues.length > 0 ? "danger" : "success"} />
          <QualityMetric label={locale === "zh" ? "高危" : "Elevees"} value={high.length} tone={high.length > 0 ? "danger" : "success"} />
          <QualityMetric label={locale === "zh" ? "财务异常" : "Finance"} value={finance.length} tone={finance.length > 0 ? "warning" : "success"} />
          <QualityMetric label={locale === "zh" ? "房态异常" : "Logements"} value={unit.length} tone={unit.length > 0 ? "neutral" : "success"} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-bold text-foreground/80">
            {locale === "zh" ? "检测时间" : "Detecte"}: {new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR")}
          </p>
          <p className={cn(
            "rounded-full px-2.5 py-1 text-xs font-bold",
            high.length > 0 ? "bg-accentRed-50 text-accentRed-700" : "bg-accentGreen-50 text-accentGreen-700",
          )}>
            {high.length > 0
              ? (locale === "zh" ? `${high.length} 个高危问题` : `${high.length} elevees`)
              : (locale === "zh" ? "无高危问题" : "Aucune haute priorite")}
          </p>
        </div>
      </div>
    </div>
  );
}

function QualityMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "neutral" | "success";
}) {
  const styles = {
    danger: {
      card: "border-accentRed-200 bg-white",
      bar: "bg-accentRed-500",
      text: "text-accentRed-700",
      dot: "bg-accentRed-100 ring-accentRed-200",
    },
    warning: {
      card: "border-accentAmber-200 bg-white",
      bar: "bg-accentAmber-500",
      text: "text-accentAmber-800",
      dot: "bg-accentAmber-100 ring-accentAmber-200",
    },
    neutral: {
      card: "border-accentBlue-200 bg-white",
      bar: "bg-accentBlue-500",
      text: "text-accentBlue-800",
      dot: "bg-accentBlue-100 ring-accentBlue-200",
    },
    success: {
      card: "border-accentGreen-200 bg-white",
      bar: "bg-accentGreen-500",
      text: "text-accentGreen-700",
      dot: "bg-accentGreen-100 ring-accentGreen-200",
    },
  }[tone];

  return (
    <div className={cn("flex min-h-[92px] overflow-hidden rounded-xl border shadow-sm", styles.card)}>
      <div className={cn("w-1.5 shrink-0", styles.bar)} />
      <div className="flex min-w-0 flex-1 flex-col justify-between px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-black text-foreground/75">{label}</p>
          <span className={cn("h-2.5 w-2.5 rounded-full ring-2", styles.dot)} />
        </div>
        <p className={cn("text-[30px] font-black leading-none tabular-nums", styles.text)}>{value}</p>
      </div>
    </div>
  );
}
