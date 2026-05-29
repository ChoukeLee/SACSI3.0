"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Search, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import type { QualityIssue, QualityCategory, QualitySeverity } from "./quality-types";

interface Props {
  issues: QualityIssue[];
  locale: Locale;
}

const CATEGORY_LABELS: Record<Locale, Record<QualityCategory, string>> = {
  zh: { unit: "房源", customer: "客户", daily_rental: "日租", lease: "长租", sale: "出售", finance: "财务", system: "系统" },
  fr: { unit: "Logement", customer: "Client", daily_rental: "Jour", lease: "Location", sale: "Vente", finance: "Finance", system: "Système" },
};

const sevTone: Record<QualitySeverity, "red" | "amber" | "indigo"> = {
  high: "red", medium: "amber", low: "indigo",
};

const sevLabels: Record<Locale, Record<QualitySeverity, string>> = {
  zh: { high: "高危", medium: "中危", low: "低危" },
  fr: { high: "Élevé", medium: "Moyen", low: "Faible" },
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

  const filterBtn = "h-9 rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";

  const zh = locale === "zh";

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <MetricCard title={zh ? "全部异常" : "Total"} value={String(issues.length)} tone="indigo" />
        <MetricCard title={zh ? "高危" : "Élevé"} value={String(high)} tone="red" />
        <MetricCard title={zh ? "中危" : "Moyen"} value={String(medium)} tone="amber" />
        <MetricCard title={zh ? "低危" : "Faible"} value={String(low)} tone="indigo" />
        <MetricCard title={zh ? "财务异常" : "Finance"} value={String(financeIssues)} tone="red" />
        <MetricCard title={zh ? "房态异常" : "Logement"} value={String(unitIssues)} tone="amber" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} className={filterBtn}>
          <option value="all">{zh ? "级别" : "Sévérité"}: {zh ? "全部" : "Tous"}</option>
          <option value="high">{zh ? "高危" : "Élevé"}</option>
          <option value="medium">{zh ? "中危" : "Moyen"}</option>
          <option value="low">{zh ? "低危" : "Faible"}</option>
        </select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={filterBtn}>
          <option value="all">{zh ? "类别" : "Catégorie"}: {zh ? "全部" : "Tous"}</option>
          {(Object.entries(catLabels) as [QualityCategory, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative flex-1 min-w-[160px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={zh ? "搜索异常..." : "Rechercher..."}
            className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <span className="text-sm text-muted-foreground ml-auto tabular-nums">{filtered.length} {zh ? "条" : "lignes"}</span>
      </div>

      {/* Issues */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert className="h-10 w-10" />}
          title={zh ? "数据质量良好，未发现异常" : "Données saines, aucune anomalie"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map(i => {
            const expanded = expandedId === i.id;
            return (
              <div
                key={i.id}
                className={cn(
                  "overflow-hidden rounded-xl border bg-card shadow-sm",
                  i.severity === "high" ? "border-l-[3px] border-l-rose-400" : i.severity === "medium" ? "border-l-[3px] border-l-amber-400" : "",
                )}
              >
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setExpandedId(expanded ? null : i.id)}
                >
                  <AlertTriangle className={cn("h-5 w-5 shrink-0", i.severity === "high" ? "text-rose-500" : i.severity === "medium" ? "text-amber-500" : "text-cyan-500")} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge variant="secondary" className="text-[10px]">{catLabels[i.category]}</Badge>
                      <Badge variant={sevTone[i.severity] === "red" ? "destructive" : sevTone[i.severity] === "amber" ? "warning" : "default"} className="text-[10px]">{sevLabels[locale][i.severity]}</Badge>
                    </div>
                    <p className="text-sm font-bold truncate">{i.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {i.entityLabel}
                      <span className="ml-2 text-muted-foreground/70">{i.detectedAt}</span>
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {i.href && (
                      <Link href={routeFor(locale, i.href)} onClick={e => e.stopPropagation()}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
                        {zh ? "查看" : "Voir"} <ArrowRight className="inline h-3 w-3 ml-0.5" />
                      </Link>
                    )}
                    {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>
                {expanded && (
                  <div className="border-t px-4 py-3 bg-muted/30 space-y-2 text-sm">
                    <div>
                      <span className="font-semibold">{zh ? "描述" : "Description"}: </span>
                      <span className="text-muted-foreground">{i.description}</span>
                    </div>
                    <div>
                      <span className="font-semibold">{zh ? "建议" : "Action"}: </span>
                      <span className="text-primary">{i.suggestedAction}</span>
                    </div>
                    {i.relatedEntities.length > 0 && (
                      <div>
                        <span className="font-semibold">{zh ? "关联实体" : "Liés"}: </span>
                        <span className="text-muted-foreground font-mono text-xs">{i.relatedEntities.map(e => e.slice(0, 8)).join(", ")}</span>
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
