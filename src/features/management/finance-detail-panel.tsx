"use client";

import { useMemo } from "react";
import type { Locale } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { financialBusinessLabel } from "@/lib/display-labels";
import { RightDrawer } from "@/components/ui/operational";
import type { ManagementFinanceItem, ManagementPaymentItem } from "@/features/management/finance-snapshot";

type DetailType = "collected" | "outstanding" | "overdue" | "upcoming";

interface Props {
  open: DetailType | null;
  onClose: () => void;
  items: ManagementFinanceItem[];
  paymentItems: ManagementPaymentItem[];
  asOf: string;
  locale: Locale;
}

const LABELS: Record<DetailType, { zh: [string, string]; fr: [string, string] }> = {
  collected: { zh: ["本月已收明细", "按实际收款日期统计；退款冲减，经营支出不冲减"], fr: ["Encaissements du mois", "Selon la date de paiement ; remboursements déduits"] },
  outstanding: { zh: ["已确认未收明细", "到期日不晚于今天、尚未收齐；不含历史待核"], fr: ["Montants confirmés à recevoir", "Échus à ce jour ; historique à vérifier exclu"] },
  overdue: { zh: ["逾期明细", "到期日早于今天且尚未收齐；不含历史待核"], fr: ["Retards", "Échéance antérieure à aujourd’hui ; historique exclu"] },
  upcoming: { zh: ["15天内应收明细", "明日起15天内到期的已确认应收"], fr: ["Échéances sous 15 jours", "Créances confirmées dues dans les 15 prochains jours"] },
};

const buildingLabel = (row: { buildingCode: string | null; buildingName: string | null }) =>
  row.buildingCode && row.buildingName && row.buildingCode !== row.buildingName
    ? `${row.buildingCode} · ${row.buildingName}`
    : row.buildingName ?? row.buildingCode ?? "—";

export function FinanceDetailPanel({ open, onClose, items, paymentItems, asOf, locale }: Props) {
  const receivableRows = useMemo(() => {
    if (!open || open === "collected") return [];
    return items.filter((item) => item.outstandingXof > 0 && (
      open === "outstanding" ? item.dueDate <= asOf
        : open === "overdue" ? item.dueDate < asOf
          : item.dueDate > asOf
    )).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [asOf, items, open]);

  if (!open) return null;
  const [title, subtitle] = LABELS[open][locale === "fr" ? "fr" : "zh"];
  const isCollected = open === "collected";
  const total = isCollected
    ? paymentItems.reduce((sum, row) => sum + (row.isRefund ? -row.amountXof : row.amountXof), 0)
    : receivableRows.reduce((sum, row) => sum + row.outstandingXof, 0);
  const count = isCollected ? paymentItems.length : receivableRows.length;

  return (
    <RightDrawer open title={title} subtitle={subtitle} onClose={onClose} width="table">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-6 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          <div><span className="text-muted-foreground">{locale === "zh" ? "笔数" : "Nombre"}：</span><b>{count}</b></div>
          <div><span className="text-muted-foreground">{locale === "zh" ? "卡片同口径合计" : "Total identique à la carte"}：</span><b className={cn("tabular-nums", open === "overdue" ? "text-accentRed-700" : open === "collected" ? "text-accentGreen-700" : "text-foreground")}>{formatXof(total)}</b></div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          <div className="max-h-[calc(100vh-190px)] overflow-auto">
            {isCollected ? (
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-muted/90 text-xs text-muted-foreground"><tr>
                  <th className="px-3 py-3">{locale === "zh" ? "收款日" : "Date"}</th><th className="px-3 py-3">{locale === "zh" ? "楼栋 / 房号" : "Bâtiment / unité"}</th><th className="px-3 py-3">{locale === "zh" ? "客户" : "Client"}</th><th className="px-3 py-3">{locale === "zh" ? "业务" : "Type"}</th><th className="px-3 py-3">{locale === "zh" ? "收据号" : "Reçu"}</th><th className="px-3 py-3 text-right">{locale === "zh" ? "净收款" : "Net"}</th>
                </tr></thead>
                <tbody className="divide-y divide-border/60">{paymentItems.length === 0 ? <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">{locale === "zh" ? "暂无数据" : "Aucune donnée"}</td></tr> : paymentItems.map((row) => <tr key={row.id}>
                  <td className="px-3 py-2.5 tabular-nums">{row.paymentDate}</td><td className="px-3 py-2.5">{buildingLabel(row)} · {row.unitNo ?? "—"}</td><td className="px-3 py-2.5">{row.customerName ?? "—"}</td><td className="px-3 py-2.5">{financialBusinessLabel(row.sourceType, locale)}</td><td className="px-3 py-2.5 font-mono text-xs">{row.receiptNo ?? "—"}</td><td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", row.isRefund ? "text-accentRed-700" : "text-accentGreen-700")}>{row.isRefund ? "−" : ""}{formatXof(row.amountXof)}</td>
                </tr>)}</tbody>
              </table>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-muted/90 text-xs text-muted-foreground"><tr>
                  <th className="px-3 py-3">{locale === "zh" ? "到期日" : "Échéance"}</th><th className="px-3 py-3">{locale === "zh" ? "楼栋 / 房号" : "Bâtiment / unité"}</th><th className="px-3 py-3">{locale === "zh" ? "客户" : "Client"}</th><th className="px-3 py-3">{locale === "zh" ? "业务" : "Type"}</th><th className="px-3 py-3 text-right">{locale === "zh" ? "应收" : "Dû"}</th><th className="px-3 py-3 text-right">{locale === "zh" ? "已收" : "Payé"}</th><th className="px-3 py-3 text-right">{locale === "zh" ? "未收" : "Reste"}</th>
                </tr></thead>
                <tbody className="divide-y divide-border/60">{receivableRows.length === 0 ? <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">{locale === "zh" ? "暂无数据" : "Aucune donnée"}</td></tr> : receivableRows.map((row) => <tr key={row.id} className={open === "overdue" ? "bg-accentRed-50/25" : ""}>
                  <td className="px-3 py-2.5 tabular-nums">{row.dueDate}</td><td className="px-3 py-2.5">{buildingLabel(row)} · {row.unitNo ?? "—"}</td><td className="px-3 py-2.5">{row.customerName ?? "—"}</td><td className="px-3 py-2.5">{financialBusinessLabel(row.sourceType, locale, row.category)}</td><td className="px-3 py-2.5 text-right tabular-nums">{formatXof(row.amountXof)}</td><td className="px-3 py-2.5 text-right text-accentGreen-700 tabular-nums">{formatXof(row.paidAmountXof)}</td><td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", open === "overdue" ? "text-accentRed-700" : "text-foreground")}>{formatXof(row.outstandingXof)}</td>
                </tr>)}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </RightDrawer>
  );
}
