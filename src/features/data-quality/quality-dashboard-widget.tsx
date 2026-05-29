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
      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-200 bg-brand-neutral-50 px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-black text-brand-neutral-950">
            <ShieldAlert className="h-4 w-4 text-brand-indigo" />
            {locale === "zh" ? "数据异常" : "Anomalies"}
          </h3>
          <span className={cn("text-xs font-semibold", high.length > 0 ? "text-brand-red-600" : "text-brand-green-600")}>
            {high.length > 0 ? `${high.length} ${locale === "zh" ? "条高危" : "elevees"}` : (locale === "zh" ? "无高危" : "OK")}
          </span>
        </div>
        <div className="divide-y divide-neutral-200">
          {top.map(i => (
            <Link
              key={i.id}
              href={routeFor(locale, "/data-quality")}
              className="flex items-center gap-2 px-5 py-2 text-xs transition-colors hover:bg-brand-indigo-50/50"
            >
              <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", i.severity === "high" ? "text-brand-red-500" : "text-brand-indigo-500")} />
              <span className="flex-1 truncate text-brand-neutral-950">{i.title}</span>
            </Link>
          ))}
        </div>
        <div className="border-t border-neutral-200 bg-brand-neutral-50 px-5 py-2">
          <Link href={routeFor(locale, "/data-quality")} className="flex items-center gap-1 text-xs font-semibold text-brand-indigo hover:underline">
            {locale === "zh" ? "查看全部" : "Voir tout"} ({issues.length}) <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className={cn(
            "flex h-10 w-10 items-center justify-center rounded-2xl",
            high.length > 0 ? "bg-brand-red-50 text-brand-red-600" : "bg-brand-green-50 text-brand-green-700",
          )}>
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-black text-brand-neutral-950">{locale === "zh" ? "数据健康" : "Sante donnees"}</h3>
            <p className="mt-0.5 text-xs font-medium text-brand-neutral-800">
              {locale === "zh" ? "自动扫描财务、房态和基础资料异常" : "Controle automatique finance, logements et donnees de base"}
            </p>
          </div>
        </div>
        <Link
          href={routeFor(locale, "/data-quality")}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-neutral-950 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-brand-neutral-900"
        >
          {locale === "zh" ? "查看全部" : "Voir tout"} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="bg-brand-neutral-50 px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QualityMetric label={locale === "zh" ? "异常总数" : "Total anomalies"} value={issues.length} tone={issues.length > 0 ? "danger" : "success"} />
          <QualityMetric label={locale === "zh" ? "高危" : "Elevees"} value={high.length} tone={high.length > 0 ? "danger" : "success"} />
          <QualityMetric label={locale === "zh" ? "财务异常" : "Finance"} value={finance.length} tone={finance.length > 0 ? "warning" : "success"} />
          <QualityMetric label={locale === "zh" ? "房态异常" : "Logements"} value={unit.length} tone={unit.length > 0 ? "neutral" : "success"} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-bold text-brand-neutral-800">
            {locale === "zh" ? "检测时间" : "Detecte"}: {new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR")}
          </p>
          <p className={cn(
            "rounded-full px-2.5 py-1 text-xs font-bold",
            high.length > 0 ? "bg-brand-red-50 text-brand-red-700" : "bg-brand-green-50 text-brand-green-700",
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
    danger: "border-brand-red-600 bg-brand-red-500 text-white shadow-[0_14px_30px_-22px_rgba(220,38,38,0.62)]",
    warning: "border-brand-indigo-500 bg-brand-indigo-400 text-brand-indigo-950 shadow-[0_14px_30px_-22px_rgba(247,127,0,0.58)]",
    neutral: "border-brand-neutral-950 bg-brand-neutral-950 text-white shadow-[0_14px_30px_-22px_rgba(26,26,26,0.58)]",
    success: "border-brand-green-600 bg-brand-green-500 text-white shadow-[0_14px_30px_-22px_rgba(0,158,96,0.62)]",
  }[tone];

  return (
    <div className={cn("min-h-[92px] rounded-2xl border p-3.5", styles)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black text-current opacity-90">{label}</p>
        <span className="h-2.5 w-2.5 rounded-full bg-white/70 ring-2 ring-white/25" />
      </div>
      <p className="mt-3 text-[30px] font-black leading-none text-current tabular-nums">{value}</p>
    </div>
  );
}
