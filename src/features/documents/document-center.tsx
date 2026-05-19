"use client";

import { useState, useMemo } from "react";
import { Search, Printer, X, FileText, Eye } from "lucide-react";
import { cn, formatXof } from "@/lib/utils";
import { printDocumentRecord } from "./templates/all-templates";
import type { DocumentRecord, DocumentType, DocumentSource, Locale } from "./types";
import {
  DOC_TYPE_LABELS, DOC_TYPE_SOURCE, SOURCE_LABELS,
} from "./types";

interface Props {
  documents: DocumentRecord[];
  locale: Locale;
}

export function DocumentCenter({ documents, locale }: Props) {
  const typeLabels = DOC_TYPE_LABELS[locale];
  const sourceLabels = SOURCE_LABELS[locale];

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

  const statusBadge = (status: string) => {
    const cls = status === "paid" || status === "checked_out" || status === "completed" ? "bg-brand-green-100 text-brand-green-700"
      : status === "overdue" ? "bg-brand-red-100 text-brand-red-700"
      : status === "pending" || status === "pending_review" ? "bg-brand-amber-100 text-amber-700"
      : status === "active" || status === "checked_in" ? "bg-brand-sky-100 text-brand-sky-700"
      : "bg-brand-warm-100 text-brand-ink-500";
    const labels: Record<string, string> = locale === "zh" ? {
      active: "生效中", draft: "草稿", terminated: "已终止", expired: "已过期",
      paid: "已收", pending: "待收", partial: "部分", overdue: "逾期",
      pending_review: "待审核", confirmed: "已确认", checked_in: "已入住", checked_out: "已退房",
      cancelled: "已取消", not_started: "未过户", in_progress: "过户中", completed: "已完成",
    } : {
      active: "Actif", draft: "Brouillon", terminated: "Resilie", expired: "Expire",
      paid: "Paye", pending: "Attente", partial: "Partiel", overdue: "Retard",
      pending_review: "A valider", confirmed: "Confirme", checked_in: "Arrive", checked_out: "Parti",
      cancelled: "Annule", not_started: "Non commence", in_progress: "En cours", completed: "Termine",
    };
    return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", cls)}>{labels[status] ?? status}</span>;
  };

  const handlePrint = (d: DocumentRecord) => {
    printDocumentRecord(d, locale);
  };

  const filterBtn = "rounded-lg border border-brand-warm-400 px-2.5 py-1 text-[11px] font-medium transition-all duration-fast bg-white";
  const filterBtnActive = "border-brand-orange bg-brand-orange-50 text-brand-orange-700";

  const inputClass = "w-full rounded border border-brand-warm-400 bg-white px-3 py-2 text-sm text-brand-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30";

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={filterBtn}>
          <option value="all">{locale === "zh" ? "单据类型" : "Type"}: {locale === "zh" ? "全部" : "Tout"}</option>
          {(Object.entries(typeLabels) as [DocumentType, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className={filterBtn}>
          <option value="all">{locale === "zh" ? "业务来源" : "Source"}: {locale === "zh" ? "全部" : "Tout"}</option>
          {(Object.entries(sourceLabels) as [DocumentSource, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={cn(filterBtn, "w-[130px]")} />
        <span className="text-xs text-brand-ink-300">—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={cn(filterBtn, "w-[130px]")} />
        <div className="relative flex-1 min-w-[180px] max-w-[320px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-brand-ink-300" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={locale === "zh" ? "搜索客户/房号/合同号..." : "Rechercher client/chambre/contrat..."}
            className="w-full rounded-lg border border-brand-warm-400 pl-8 pr-3 py-1.5 text-xs text-brand-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30"
          />
        </div>
        <span className="text-xs text-brand-ink-300 ml-auto">
          {filtered.length} {locale === "zh" ? "条单据" : "documents"}
        </span>
      </div>

      <div className="flex gap-4">
        {/* Document list */}
        <div className={cn("flex-1 min-w-0", previewed && "hidden lg:block")}>
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-brand-warm-400 bg-white py-16 text-center text-sm text-brand-ink-300 shadow-card">
              {locale === "zh" ? "暂无符合条件的单据" : "Aucun document"}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-brand-warm-400 bg-white shadow-card">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="border-b border-brand-warm-400 bg-brand-warm-50 text-[10px] font-semibold uppercase tracking-wider text-brand-ink-500">
                  <tr>
                    <th className="px-3 py-2.5">{locale === "zh" ? "单据类型" : "Type"}</th>
                    <th className="px-3 py-2.5">{locale === "zh" ? "标题" : "Libelle"}</th>
                    <th className="px-3 py-2.5">{locale === "zh" ? "日期" : "Date"}</th>
                    <th className="px-3 py-2.5">{locale === "zh" ? "房号" : "Chambre"}</th>
                    <th className="px-3 py-2.5">{locale === "zh" ? "客户" : "Client"}</th>
                    <th className="px-3 py-2.5 text-right">{locale === "zh" ? "金额" : "Montant"}</th>
                    <th className="px-3 py-2.5">{locale === "zh" ? "状态" : "Statut"}</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-warm-400">
                  {filtered.map(d => (
                    <tr
                      key={d.id}
                      className={cn(
                        "transition-colors cursor-pointer hover:bg-brand-warm-50",
                        previewId === d.id && "bg-brand-orange-50/50",
                      )}
                      onClick={() => setPreviewId(d.id)}
                    >
                      <td className="px-3 py-2">
                        <span className="rounded bg-brand-warm-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-ink-500">
                          {typeLabels[d.docType]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-brand-ink-700 max-w-[160px] truncate">{d.title}</td>
                      <td className="px-3 py-2 text-brand-ink-400 whitespace-nowrap">{d.date}</td>
                      <td className="px-3 py-2 font-mono text-brand-ink-600">{d.unitNo || "—"}</td>
                      <td className="px-3 py-2 text-brand-ink-600 max-w-[80px] truncate">{d.customerName || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-brand-ink-700">{formatXof(d.amountXof)}</td>
                      <td className="px-3 py-2">{statusBadge(d.status)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={e => { e.stopPropagation(); setPreviewId(d.id); }}
                            className="rounded p-1 text-brand-ink-300 hover:text-brand-orange hover:bg-brand-warm-100"
                            title={locale === "zh" ? "预览" : "Apercu"}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handlePrint(d); }}
                            className="rounded p-1 text-brand-ink-300 hover:text-brand-orange hover:bg-brand-warm-100"
                            title={locale === "zh" ? "打印" : "Imprimer"}
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
          )}
        </div>

        {/* Preview panel */}
        {previewed && (
          <div className="w-[380px] shrink-0 rounded-xl border border-brand-warm-400 bg-white shadow-card flex flex-col">
            <div className="flex items-center justify-between border-b border-brand-warm-400 px-4 py-3">
              <h3 className="text-sm font-bold text-brand-ink-900 flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-brand-orange" />
                {locale === "zh" ? "单据预览" : "Apercu"}
              </h3>
              <button onClick={() => setPreviewId(null)} className="rounded p-1 text-brand-ink-300 hover:bg-brand-warm-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div className="text-center border-b border-brand-warm-300 pb-3">
                <p className="text-[10px] uppercase tracking-wider text-brand-orange font-semibold">SACIS 3.0 · {locale === "zh" ? "科建地产" : "Kejian Immobilier"}</p>
                <p className="text-sm font-bold text-brand-ink-900 mt-1">{typeLabels[previewed.docType]}</p>
              </div>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between"><dt className="text-brand-ink-400">{locale === "zh" ? "标题" : "Libelle"}</dt><dd className="font-medium text-brand-ink-700">{previewed.title}</dd></div>
                <div className="flex justify-between"><dt className="text-brand-ink-400">{locale === "zh" ? "日期" : "Date"}</dt><dd className="text-brand-ink-600">{previewed.date}</dd></div>
                <div className="flex justify-between"><dt className="text-brand-ink-400">{locale === "zh" ? "房号" : "Chambre"}</dt><dd className="font-mono text-brand-ink-700">{previewed.unitNo || "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-brand-ink-400">{locale === "zh" ? "客户" : "Client"}</dt><dd className="text-brand-ink-700">{previewed.customerName || "—"}</dd></div>
                {previewed.customerPhone && <div className="flex justify-between"><dt className="text-brand-ink-400">{locale === "zh" ? "电话" : "Tel"}</dt><dd className="text-brand-ink-600">{previewed.customerPhone}</dd></div>}
                {previewed.contractNo && <div className="flex justify-between"><dt className="text-brand-ink-400">{locale === "zh" ? "合同号" : "N° contrat"}</dt><dd className="font-mono text-brand-ink-600">{previewed.contractNo}</dd></div>}
                <div className="flex justify-between border-t border-brand-warm-300 pt-2"><dt className="text-brand-ink-400">{locale === "zh" ? "金额" : "Montant"}</dt><dd className="font-semibold text-brand-ink-900">{formatXof(previewed.amountXof)}</dd></div>
                {previewed.amountXof > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-brand-ink-400">{locale === "zh" ? "已收" : "Paye"}</dt>
                    <dd className={cn("font-semibold", previewed.paidAmountXof > 0 ? "text-brand-green-700" : "text-brand-ink-300")}>{formatXof(previewed.paidAmountXof)}</dd>
                  </div>
                )}
                {previewed.amountXof - previewed.paidAmountXof > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-brand-red-500">{locale === "zh" ? "未收" : "Du"}</dt>
                    <dd className="font-semibold text-brand-red-600">{formatXof(previewed.amountXof - previewed.paidAmountXof)}</dd>
                  </div>
                )}
                <div className="flex justify-between"><dt className="text-brand-ink-400">{locale === "zh" ? "状态" : "Statut"}</dt><dd>{statusBadge(previewed.status)}</dd></div>
              </dl>
              <div className="border-t border-brand-warm-300 pt-3">
                <button
                  onClick={() => handlePrint(previewed)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-ink-700 active:scale-[0.98] transition-all"
                >
                  <Printer className="h-4 w-4" />{locale === "zh" ? "打印单据" : "Imprimer"}
                </button>
                <p className="mt-1.5 text-[10px] text-brand-ink-300 text-center">
                  {locale === "zh" ? "打印时自动隐藏侧栏，仅保留单据正文" : "L'impression masque la navigation"}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
