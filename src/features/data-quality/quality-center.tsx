"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Search, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { QualityIssue, QualityCategory, QualitySeverity } from "./quality-types";

interface Props {
  issues: QualityIssue[];
  locale: Locale;
}

const SEVERITY_STYLES: Record<QualitySeverity, string> = {
  high: "bg-brand-red-50/30",
  medium: "bg-brand-amber-50/20",
  low: "bg-white",
};
const SEVERITY_DOT: Record<QualitySeverity, string> = {
  high: "bg-brand-red-500",
  medium: "bg-brand-amber-500",
  low: "bg-brand-sky-400",
};

const CATEGORY_LABELS: Record<Locale, Record<QualityCategory, string>> = {
  zh: { unit: "房源", customer: "客户", daily_rental: "日租", lease: "长租", sale: "出售", finance: "财务", system: "系统" },
  fr: { unit: "Logement", customer: "Client", daily_rental: "Jour", lease: "Location", sale: "Vente", finance: "Finance", system: "Systeme" },
};

export function QualityCenter({ issues, locale }: Props) {
  const catLabels = CATEGORY_LABELS[locale];

  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return issues.filter(i => {
      if (severityFilter !== "all" && i.severity !== severityFilter) return false;
      if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!`${i.title} ${i.description} ${i.entityLabel}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [issues, severityFilter, categoryFilter, search]);

  const high = issues.filter(i => i.severity === "high").length;
  const medium = issues.filter(i => i.severity === "medium").length;
  const low = issues.filter(i => i.severity === "low").length;
  const financeIssues = issues.filter(i => i.category === "finance").length;
  const unitIssues = issues.filter(i => i.category === "unit").length;

  const filterBtn = "rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50";

  const sevBadge = (s: QualitySeverity) => {
    const st: Record<QualitySeverity, string> = { high: "bg-brand-red-100 text-brand-red-700", medium: "bg-brand-amber-100 text-brand-amber-700", low: "bg-brand-sky-100 text-brand-sky-700" };
    const l: Record<Locale, Record<QualitySeverity, string>> = { zh: { high: "高危", medium: "中危", low: "低危" }, fr: { high: "Eleve", medium: "Moyen", low: "Faible" } };
    return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", st[s])}>{l[locale][s]}</span>;
  };

  return (
    <div>
      {/* Summary */}
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Pill label={locale === "zh" ? "全部异常" : "Total"} value={issues.length} accent="ink" />
        <Pill label={locale === "zh" ? "高危" : "Eleve"} value={high} accent="red" />
        <Pill label={locale === "zh" ? "中危" : "Moyen"} value={medium} accent="orange" />
        <Pill label={locale === "zh" ? "低危" : "Faible"} value={low} accent="sky" />
        <Pill label={locale === "zh" ? "财务异常" : "Finance"} value={financeIssues} accent="red" />
        <Pill label={locale === "zh" ? "房态异常" : "Logement"} value={unitIssues} accent="orange" />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} className={filterBtn}>
          <option value="all">{locale === "zh" ? "级别" : "Severite"}: {locale === "zh" ? "全部" : "Tous"}</option>
          <option value="high">{locale === "zh" ? "高危" : "Eleve"}</option>
          <option value="medium">{locale === "zh" ? "中危" : "Moyen"}</option>
          <option value="low">{locale === "zh" ? "低危" : "Faible"}</option>
        </select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={filterBtn}>
          <option value="all">{locale === "zh" ? "类别" : "Categorie"}: {locale === "zh" ? "全部" : "Tous"}</option>
          {(Object.entries(catLabels) as [QualityCategory, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative flex-1 min-w-[160px] max-w-[300px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-brand-ink-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={locale === "zh" ? "搜索异常..." : "Rechercher..."}
            className="w-full rounded-xl border border-brand-warm-200 bg-white py-1.5 pl-8 pr-3 text-xs text-brand-ink-700 shadow-sm transition focus:border-brand-orange-300 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/15" />
        </div>
        <span className="text-xs font-semibold text-brand-ink-400 ml-auto">{filtered.length} {locale === "zh" ? "条" : "lignes"}</span>
      </div>

      {/* Issues */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-brand-warm-200 bg-white py-16 text-center text-sm shadow-natural">
          <ShieldAlert className="mx-auto h-8 w-8 mb-3 text-brand-green-400" />
          <p className="text-brand-green-600 font-medium">{locale === "zh" ? "数据质量良好，未发现异常" : "Donnees saines, aucune anomalie"}</p>
          <p className="text-brand-ink-400 text-xs mt-1">{locale === "zh" ? `共扫描 ${issues.length} 条规则` : `${issues.length} regles verifiees`}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(i => {
            const expanded = expandedId === i.id;
            return (
              <div
                key={i.id}
                className={cn(
                  "overflow-hidden rounded-2xl border border-brand-warm-200 bg-white shadow-natural",
                  SEVERITY_STYLES[i.severity],
                )}
              >
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-brand-warm-50/80"
                  onClick={() => setExpandedId(expanded ? null : i.id)}
                >
                  <AlertTriangle className={cn("h-5 w-5 shrink-0", i.severity === "high" ? "text-brand-red-500" : i.severity === "medium" ? "text-brand-amber-500" : "text-brand-sky-400")} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] rounded-full bg-brand-warm-100 px-2 py-0.5 text-brand-ink-600 ring-1 ring-inset ring-slate-200">{catLabels[i.category]}</span>
                      {sevBadge(i.severity)}
                    </div>
                    <p className="text-sm font-bold text-brand-ink-900 truncate">{i.title}</p>
                    <p className="text-xs text-brand-ink-500 truncate">
                      {i.entityLabel}
                      <span className="ml-2 text-brand-ink-400">{i.detectedAt}</span>
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {i.href && (
                      <Link href={routeFor(locale, i.href)} onClick={e => e.stopPropagation()}
                        className="rounded-xl bg-brand-orange-500 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm transition hover:bg-brand-orange-600">
                        {locale === "zh" ? "查看" : "Voir"} <ArrowRight className="inline h-3 w-3 ml-0.5" />
                      </Link>
                    )}
                    {expanded ? <ChevronUp className="h-4 w-4 text-brand-ink-400" /> : <ChevronDown className="h-4 w-4 text-brand-ink-400" />}
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-slate-100 px-4 py-3 bg-brand-warm-50/70 space-y-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-800">{locale === "zh" ? "描述" : "Description"}: </span>
                      <span className="text-brand-ink-600">{i.description}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-800">{locale === "zh" ? "建议" : "Action"}: </span>
                      <span className="text-brand-orange-700">{i.suggestedAction}</span>
                    </div>
                    {i.relatedEntities.length > 0 && (
                      <div>
                        <span className="font-semibold text-slate-800">{locale === "zh" ? "关联实体" : "Lies"}: </span>
                        <span className="text-brand-ink-500 font-mono">{i.relatedEntities.map(e => e.slice(0, 8)).join(", ")}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Pill({ label, value, accent }: { label: string; value: number; accent: string }) {
  const colors: Record<string, string> = {
    ink: "bg-slate-800",
    red: "bg-brand-red-500",
    orange: "bg-brand-orange",
    sky: "bg-brand-sky-500",
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-brand-warm-200 bg-white shadow-natural"><div className={cn("h-[3px]", colors[accent] ?? "bg-slate-800")} /><div className="px-3 py-2">
      <p className="text-[10px] font-semibold text-brand-ink-400">{label}</p>
      <p className="text-lg font-black tabular-nums">{value}</p>
    </div></div>
  );
}
