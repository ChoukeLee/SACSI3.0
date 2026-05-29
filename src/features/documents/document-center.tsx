"use client";

import { useState, useMemo } from "react";
import { Printer, X, FileText, Eye } from "lucide-react";
import { cn, formatXof } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { printDocumentRecord } from "./templates/all-templates";
import type { DocumentRecord, DocumentType, DocumentSource, Locale } from "./types";
import {
  DOC_TYPE_LABELS, DOC_TYPE_SOURCE, SOURCE_LABELS,
} from "./types";

interface Props {
  documents: DocumentRecord[];
  locale: Locale;
}

const statusLabels: Record<string, Record<string, string>> = {
  zh: {
    active: "生效中", draft: "草稿", terminated: "已终止", expired: "已过期",
    paid: "已收", pending: "待收", partial: "部分", overdue: "逾期",
    pending_review: "待审核", confirmed: "已确认", checked_in: "已入住", checked_out: "已退房",
    cancelled: "已取消", not_started: "未过户", in_progress: "过户中", completed: "已完成",
  },
  fr: {
    active: "Actif", draft: "Brouillon", terminated: "Résilié", expired: "Expiré",
    paid: "Payé", pending: "Attente", partial: "Partiel", overdue: "Retard",
    pending_review: "À valider", confirmed: "Confirmé", checked_in: "Arrivé", checked_out: "Parti",
    cancelled: "Annulé", not_started: "Non commencé", in_progress: "En cours", completed: "Terminé",
  },
};

const statusTone: Record<string, "success" | "destructive" | "warning" | "secondary" | "default"> = {
  active: "success", checked_in: "success", completed: "success", paid: "success",
  overdue: "destructive", cancelled: "destructive",
  pending: "warning", pending_review: "warning", partial: "warning",
  draft: "secondary", expired: "secondary", terminated: "secondary", checked_out: "secondary",
};

export function DocumentCenter({ documents, locale }: Props) {
  const typeLabels = DOC_TYPE_LABELS[locale];
  const sourceLabels = SOURCE_LABELS[locale];
  const stLabels = statusLabels[locale];

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return documents.filter((d) => {
      if (typeFilter !== "all" && d.docType !== typeFilter) return false;
      if (sourceFilter !== "all" && d.source !== sourceFilter) return false;
      if (dateFrom && d.date < dateFrom) return false;
      if (dateTo && d.date > dateTo) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const haystack = [
          d.customerName, d.unitNo, d.contractNo ?? "",
          d.customerPhone ?? "", d.title,
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [documents, typeFilter, sourceFilter, dateFrom, dateTo, search]);

  const previewed = previewId ? documents.find(d => d.id === previewId) : null;
  const zh = locale === "zh";

  const handlePrint = (d: DocumentRecord) => {
    printDocumentRecord(d, locale);
  };

  const filterBtn = "h-9 rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={filterBtn}>
          <option value="all">{zh ? "单据类型" : "Type"}: {zh ? "全部" : "Tout"}</option>
          {(Object.entries(typeLabels) as [DocumentType, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className={filterBtn}>
          <option value="all">{zh ? "业务来源" : "Source"}: {zh ? "全部" : "Tout"}</option>
          {(Object.entries(sourceLabels) as [DocumentSource, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={cn(filterBtn, "w-[140px]")} />
        <span className="text-sm font-semibold text-muted-foreground">—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={cn(filterBtn, "w-[140px]")} />
        <div className="relative flex-1 min-w-[180px] max-w-[320px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={zh ? "搜索客户/房号/合同号..." : "Rechercher client/chambre/contrat..."}
            className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} {zh ? "条单据" : "documents"}
        </span>
      </div>

      <div className="flex gap-4">
        {/* Document list */}
        <div className={cn("flex-1 min-w-0", previewed && "hidden lg:block")}>
          {filtered.length === 0 ? (
            <EmptyState title={zh ? "暂无符合条件的单据" : "Aucun document"} />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px] min-w-[700px]">
                  <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">{zh ? "单据类型" : "Type"}</th>
                      <th className="px-4 py-2.5">{zh ? "标题" : "Libellé"}</th>
                      <th className="px-4 py-2.5">{zh ? "日期" : "Date"}</th>
                      <th className="px-4 py-2.5">{zh ? "房号" : "Chambre"}</th>
                      <th className="px-4 py-2.5">{zh ? "客户" : "Client"}</th>
                      <th className="px-4 py-2.5 text-right">{zh ? "金额" : "Montant"}</th>
                      <th className="px-4 py-2.5">{zh ? "状态" : "Statut"}</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map(d => (
                      <tr
                        key={d.id}
                        className={cn(
                          "transition-colors cursor-pointer hover:bg-accent/50",
                          previewId === d.id && "bg-accent/50",
                        )}
                        onClick={() => setPreviewId(d.id)}
                      >
                        <td className="px-4 py-2.5">
                          <Badge variant="secondary" className="text-xs">{typeLabels[d.docType]}</Badge>
                        </td>
                        <td className="px-4 py-2.5 max-w-[160px] truncate">{d.title}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{d.date}</td>
                        <td className="px-4 py-2.5 font-mono">{d.unitNo || "—"}</td>
                        <td className="px-4 py-2.5 max-w-[80px] truncate">{d.customerName || "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatXof(d.amountXof)}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={statusTone[d.status] ?? "secondary"} className="text-xs">{stLabels[d.status] ?? d.status}</Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={e => { e.stopPropagation(); setPreviewId(d.id); }}
                              className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                              title={zh ? "预览" : "Aperçu"}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handlePrint(d); }}
                              className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                              title={zh ? "打印" : "Imprimer"}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Preview panel */}
        {previewed && (
          <div className="w-[380px] shrink-0 rounded-xl border bg-card shadow-sm flex flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-primary" />
                {zh ? "单据预览" : "Aperçu"}
              </h3>
              <button onClick={() => setPreviewId(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div className="text-center border-b pb-3">
                <p className="text-xs uppercase tracking-[0.04em] text-primary font-semibold">SACIS 3.0 · {zh ? "科建地产" : "Kejian Immobilier"}</p>
                <p className="text-sm font-bold mt-1">{typeLabels[previewed.docType]}</p>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "标题" : "Libellé"}</dt><dd className="font-medium">{previewed.title}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "日期" : "Date"}</dt><dd>{previewed.date}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "房号" : "Chambre"}</dt><dd className="font-mono">{previewed.unitNo || "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "客户" : "Client"}</dt><dd>{previewed.customerName || "—"}</dd></div>
                {previewed.customerPhone && <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "电话" : "Tél"}</dt><dd>{previewed.customerPhone}</dd></div>}
                {previewed.contractNo && <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "合同号" : "N° contrat"}</dt><dd className="font-mono">{previewed.contractNo}</dd></div>}
                <div className="flex justify-between border-t pt-2"><dt className="text-muted-foreground">{zh ? "金额" : "Montant"}</dt><dd className="font-semibold">{formatXof(previewed.amountXof)}</dd></div>
                {previewed.amountXof > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{zh ? "已收" : "Payé"}</dt>
                    <dd className={cn("font-semibold", previewed.paidAmountXof > 0 ? "text-emerald-600" : "text-muted-foreground")}>{formatXof(previewed.paidAmountXof)}</dd>
                  </div>
                )}
                {previewed.amountXof - previewed.paidAmountXof > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-rose-600">{zh ? "未收" : "Dû"}</dt>
                    <dd className="font-semibold text-rose-600">{formatXof(previewed.amountXof - previewed.paidAmountXof)}</dd>
                  </div>
                )}
                <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "状态" : "Statut"}</dt><dd><Badge variant={statusTone[previewed.status] ?? "secondary"} className="text-xs">{stLabels[previewed.status] ?? previewed.status}</Badge></dd></div>
              </dl>
              <div className="border-t pt-3">
                <button
                  onClick={() => handlePrint(previewed)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.98]"
                >
                  <Printer className="h-4 w-4" />{zh ? "打印单据" : "Imprimer"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}
