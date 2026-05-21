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
      <div className="overflow-hidden rounded-xl border border-brand-warm-400 bg-white shadow-natural">
        <div className="flex items-center justify-between border-b border-brand-warm-200 bg-brand-warm-50/50 px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-brand-ink-900">
            <ShieldAlert className="h-4 w-4 text-brand-orange" />
            {locale === "zh" ? "数据异常" : "Anomalies"}
          </h3>
          <span className={cn("text-xs font-medium", high.length > 0 ? "text-brand-red-600" : "text-brand-green-600")}>
            {high.length > 0 ? `${high.length} ${locale === "zh" ? "条高危" : "elevees"}` : (locale === "zh" ? "无高危" : "OK")}
          </span>
        </div>
        <div className="divide-y divide-brand-warm-200">
          {top.map(i => (
            <Link
              key={i.id}
              href={routeFor(locale, "/data-quality")}
              className="flex items-center gap-2 px-5 py-2 text-xs transition-colors hover:bg-brand-warm-50"
            >
              <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", i.severity === "high" ? "text-brand-red-500" : "text-brand-amber-500")} />
              <span className="flex-1 truncate text-brand-ink-700">{i.title}</span>
            </Link>
          ))}
        </div>
        <div className="border-t border-brand-warm-200 bg-brand-warm-50/30 px-5 py-2">
          <Link href={routeFor(locale, "/data-quality")} className="flex items-center gap-1 text-xs font-medium text-brand-orange hover:underline">
            {locale === "zh" ? "查看全部" : "Voir tout"} ({issues.length}) <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={cn(
            "flex h-8 w-8 items-center justify-center rounded-xl",
            high.length > 0 ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-600",
          )}>
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-base font-bold text-slate-900">{locale === "zh" ? "数据健康" : "Sante donnees"}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {locale === "zh" ? "自动扫描财务、房态和基础资料异常" : "Controle automatique finance, logements et donnees de base"}
            </p>
          </div>
        </div>
        <Link
          href={routeFor(locale, "/data-quality")}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-700"
        >
          {locale === "zh" ? "查看全部" : "Voir tout"} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="bg-slate-50/60 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QualityMetric label={locale === "zh" ? "异常总数" : "Total anomalies"} value={issues.length} tone={issues.length > 0 ? "rose" : "emerald"} />
          <QualityMetric label={locale === "zh" ? "高危" : "Elevees"} value={high.length} tone={high.length > 0 ? "rose" : "emerald"} />
          <QualityMetric label={locale === "zh" ? "财务异常" : "Finance"} value={finance.length} tone={finance.length > 0 ? "amber" : "emerald"} />
          <QualityMetric label={locale === "zh" ? "房态异常" : "Logements"} value={unit.length} tone={unit.length > 0 ? "sky" : "emerald"} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <p className="text-xs font-semibold text-slate-500">
            {locale === "zh" ? "检测时间" : "Detecte"}: {new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR")}
          </p>
          <p className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-bold",
            high.length > 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700",
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
  tone: "rose" | "amber" | "sky" | "emerald";
}) {
  const styles = {
    rose: "border-rose-300 bg-rose-500 text-white",
    amber: "border-amber-300 bg-amber-400 text-amber-950",
    sky: "border-sky-300 bg-sky-500 text-white",
    emerald: "border-emerald-300 bg-emerald-500 text-white",
  }[tone];

  return (
    <div className={cn("min-h-[92px] rounded-2xl border p-3 shadow-sm", styles)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold opacity-90">{label}</p>
        <span className="h-2 w-2 rounded-full bg-white/70" />
      </div>
      <p className="mt-3 text-3xl font-black tabular-nums">{value}</p>
    </div>
  );
}
