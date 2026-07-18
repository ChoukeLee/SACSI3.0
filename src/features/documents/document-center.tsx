"use client";

import { useState, useMemo } from "react";
import { Printer, X, FileText, Eye } from "lucide-react";
import { cn, formatXof } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/ui/date-input";
import { EmptyState } from "@/components/empty-state";
import { FilterBar, FilterGroup, SegmentedControl, controlClass } from "@/components/ui/operational";
import { SearchInput } from "@/components/ui/search-input";
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

function documentMoneyView(d: DocumentRecord, zh: boolean) {
  const amount = Math.max(0, Number(d.amountXof) || 0);
  const paid = Math.max(0, Number(d.paidAmountXof) || 0);
  const outstanding = Math.max(0, amount - paid);
  const hasPartialPayment = outstanding > 0 && paid > 0;
  const isReceivableLike = d.docType === "daily_booking" || d.docType === "daily_checkout" || d.docType === "lease_reminder";
  if (hasPartialPayment && isReceivableLike) {
    return {
      primary: outstanding,
      label: zh ? "未收" : "Dû",
      tone: "text-rose-600",
      caption: `${zh ? "应收" : "Total"} ${formatXof(amount)} · ${zh ? "已收" : "Payé"} ${formatXof(paid)}`,
    };
  }
  return {
    primary: amount,
    label: null,
    tone: "text-foreground",
    caption: hasPartialPayment ? `${zh ? "已收" : "Payé"} ${formatXof(paid)}` : null,
  };
}

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
  const filterDate = cn(controlClass, "w-[140px]");

  return (
    <div className="space-y-5">
      {/* Filters */}
      <FilterBar
        meta={<span className="tabular-nums">{filtered.length} {zh ? "条单据" : "documents"}</span>}
      >
        <FilterGroup label={zh ? "单据类型" : "Type"}>
          <SegmentedControl
            value={typeFilter}
            onChange={setTypeFilter}
            ariaLabel={zh ? "单据类型筛选" : "Filtre type"}
            items={[
              { value: "all", label: zh ? "全部" : "Tout" },
              ...(Object.entries(typeLabels) as [DocumentType, string][]).map(([value, label]) => ({ value, label })),
            ]}
          />
        </FilterGroup>
        <FilterGroup label={zh ? "业务来源" : "Source"}>
          <SegmentedControl
            value={sourceFilter}
            onChange={setSourceFilter}
            ariaLabel={zh ? "业务来源筛选" : "Filtre source"}
            items={[
              { value: "all", label: zh ? "全部" : "Tout" },
              ...(Object.entries(sourceLabels) as [DocumentSource, string][]).map(([value, label]) => ({ value, label })),
            ]}
          />
        </FilterGroup>
        <FilterGroup label={zh ? "日期" : "Date"}>
          <DateInput value={dateFrom} onChangeValue={setDateFrom} className={filterDate} />
          <span className="px-0.5 text-xs font-semibold text-muted-foreground">-</span>
          <DateInput value={dateTo} onChangeValue={setDateTo} className={filterDate} />
        </FilterGroup>
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={zh ? "搜索客户/房号/合同号..." : "Rechercher client/chambre/contrat..."}
          className="w-full sm:w-[320px]"
        />
      </FilterBar>

      <div className="flex gap-4">
        {/* Document list */}
        <div className={cn("flex-1 min-w-0", previewed && "hidden lg:block")}>
          {filtered.length === 0 ? (
            <EmptyState title={zh ? "暂无符合条件的单据" : "Aucun document"} />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px] min-w-[700px]">
                  <thead className="border-b bg-muted text-xs font-medium text-muted-foreground">
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
                    {filtered.map(d => {
                      const money = documentMoneyView(d, zh);
                      return (
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
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <div className={cn("font-semibold", money.tone)}>
                              {money.label && <span className="mr-1 text-xs font-medium">{money.label}</span>}
                              {formatXof(money.primary)}
                            </div>
                            {money.caption && <div className="mt-0.5 text-[12px] text-muted-foreground">{money.caption}</div>}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge variant={statusTone[d.status] ?? "secondary"} className="text-xs">{stLabels[d.status] ?? d.status}</Badge>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={e => { e.stopPropagation(); setPreviewId(d.id); }}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                title={zh ? "预览" : "Aperçu"}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); handlePrint(d); }}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                title={zh ? "打印" : "Imprimer"}
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <FileText className="h-4 w-4 text-primary" />
                {zh ? "单据预览" : "Aperçu"}
              </h3>
              <button onClick={() => setPreviewId(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div className="text-center border-b pb-3">
                <p className="text-xs font-medium text-primary">SACSI · {zh ? "科建地产" : "Kejian Immobilier"}</p>
                <p className="mt-1 text-sm font-medium">{typeLabels[previewed.docType]}</p>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "标题" : "Libellé"}</dt><dd className="font-medium">{previewed.title}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "日期" : "Date"}</dt><dd>{previewed.date}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "房号" : "Chambre"}</dt><dd className="font-mono">{previewed.unitNo || "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "客户" : "Client"}</dt><dd>{previewed.customerName || "—"}</dd></div>
                {previewed.customerPhone && <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "电话" : "Tél"}</dt><dd>{previewed.customerPhone}</dd></div>}
                {previewed.contractNo && <div className="flex justify-between"><dt className="text-muted-foreground">{zh ? "合同号" : "N° contrat"}</dt><dd className="font-mono">{previewed.contractNo}</dd></div>}
                <div className="flex justify-between border-t pt-2"><dt className="text-muted-foreground">{zh ? "应收" : "Total"}</dt><dd className="font-semibold">{formatXof(previewed.amountXof)}</dd></div>
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
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.98]"
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
