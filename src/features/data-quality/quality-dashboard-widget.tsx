"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, ShieldAlert } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/operational";
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
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
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
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-card px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            high.length > 0 ? "bg-accentRed-50 text-accentRed-600" : "bg-accentGreen-50 text-accentGreen-700",
          )}>
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">{locale === "zh" ? "数据健康" : "Sante donnees"}</h3>
            <p className="mt-0.5 text-xs font-medium text-foreground/80">
              {locale === "zh" ? "自动扫描财务、房态和基础资料异常" : "Controle automatique finance, logements et donnees de base"}
            </p>
          </div>
        </div>
        <Button asChild size="sm">
          <Link href={routeFor(locale, "/data-quality")}>
            {locale === "zh" ? "查看全部" : "Voir tout"} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      <div className="bg-card px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QualityMetric label={locale === "zh" ? "异常总数" : "Total anomalies"} value={issues.length} tone={issues.length > 0 ? "danger" : "success"} />
          <QualityMetric label={locale === "zh" ? "高危" : "Elevees"} value={high.length} tone={high.length > 0 ? "danger" : "success"} />
          <QualityMetric label={locale === "zh" ? "财务异常" : "Finance"} value={finance.length} tone={finance.length > 0 ? "warning" : "success"} />
          <QualityMetric label={locale === "zh" ? "房态异常" : "Logements"} value={unit.length} tone={unit.length > 0 ? "neutral" : "success"} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5 shadow-xs">
          <p className="text-xs font-semibold text-foreground/80">
            {locale === "zh" ? "检测时间" : "Detecte"}: {new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR")}
          </p>
          <p className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
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
  const tileTone = {
    danger: "red",
    warning: "amber",
    neutral: "blue",
    success: "green",
  }[tone] as "red" | "amber" | "blue" | "green";

  return <StatTile label={label} value={value} tone={tileTone} />;
}
