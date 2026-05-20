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
    // Compact dashboard widget
    if (issues.length === 0) return null;
    const top = issues.slice(0, 5);
    return (
      <div className="rounded-xl border border-brand-warm-400 bg-white shadow-natural overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-brand-warm-200 bg-brand-warm-50/50">
          <h3 className="text-sm font-bold text-brand-ink-900 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-brand-orange" />
            {locale === "zh" ? "数据异常" : "Anomalies"}
          </h3>
          <span className={cn("text-xs font-medium", high.length > 0 ? "text-brand-red-600" : "text-brand-green-600")}>
            {high.length > 0 ? `${high.length} ${locale === "zh" ? "条高危" : "elevees"}` : (locale === "zh" ? "无高危" : "OK")}
          </span>
        </div>
        <div className="divide-y divide-brand-warm-200">
          {top.map(i => (
            <Link key={i.id} href={routeFor(locale, "/data-quality")}
              className="flex items-center gap-2 px-5 py-2 text-xs hover:bg-brand-warm-50 transition-colors">
              <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", i.severity === "high" ? "text-brand-red-500" : "text-brand-amber-500")} />
              <span className="flex-1 truncate text-brand-ink-700">{i.title}</span>
            </Link>
          ))}
        </div>
        <div className="px-5 py-2 border-t border-brand-warm-200 bg-brand-warm-50/30">
          <Link href={routeFor(locale, "/data-quality")} className="text-xs font-medium text-brand-orange hover:underline flex items-center gap-1">
            {locale === "zh" ? "查看全部" : "Voir tout"} ({issues.length}) <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    );
  }

  // Management variant: data health card
  return (
    <div className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-natural">
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert className="h-5 w-5 text-brand-orange" />
        <h3 className="text-sm font-bold text-brand-ink-900">{locale === "zh" ? "数据健康" : "Sante donnees"}</h3>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className={cn("rounded border px-3 py-2", issues.length > 0 ? "border-brand-red-200 bg-brand-red-50" : "border-brand-green-200 bg-brand-green-50")}>
          <p className="text-brand-ink-400">{locale === "zh" ? "异常总数" : "Total anomalies"}</p>
          <p className={cn("font-bold text-lg tabular-nums", issues.length > 0 ? "text-brand-red-700" : "text-brand-green-700")}>{issues.length}</p>
        </div>
        <div className={cn("rounded border px-3 py-2", high.length > 0 ? "border-brand-red-200 bg-brand-red-50" : "border-brand-green-200 bg-brand-green-50")}>
          <p className="text-brand-ink-400">{locale === "zh" ? "高危" : "Elevees"}</p>
          <p className={cn("font-bold text-lg tabular-nums", high.length > 0 ? "text-brand-red-700" : "text-brand-green-700")}>{high.length}</p>
        </div>
        <div className={cn("rounded border px-3 py-2", finance.length > 0 ? "border-brand-orange-200 bg-brand-orange-50" : "border-brand-green-200 bg-brand-green-50")}>
          <p className="text-brand-ink-400">{locale === "zh" ? "财务异常" : "Finance"}</p>
          <p className={cn("font-bold text-lg tabular-nums", finance.length > 0 ? "text-brand-orange-700" : "text-brand-green-700")}>{finance.length}</p>
        </div>
        <div className={cn("rounded border px-3 py-2", unit.length > 0 ? "border-brand-amber-200 bg-brand-amber-50" : "border-brand-green-200 bg-brand-green-50")}>
          <p className="text-brand-ink-400">{locale === "zh" ? "房态异常" : "Logements"}</p>
          <p className={cn("font-bold text-lg tabular-nums", unit.length > 0 ? "text-brand-amber-700" : "text-brand-green-700")}>{unit.length}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-brand-ink-300">
        {locale === "zh" ? "检测时间" : "Detecte"}: {new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR")}
      </p>
      <Link href={routeFor(locale, "/data-quality")}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-ink-700 transition-colors">
        {locale === "zh" ? "查看全部" : "Voir tout"} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
