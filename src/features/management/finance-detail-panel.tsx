"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { RightDrawer } from "@/components/ui/operational";
import { receivableStatusStyles as STATUS_STYLES } from "@/lib/status-styles";
import type { ManagementFinanceItem } from "@/features/management/finance-snapshot";
import type {
  BuildingRow, UnitRow, ReceivableRow, CustomerRow,
} from "@/types/database";

type DetailType = "receivable" | "collected" | "outstanding" | "overdue";

interface Props {
  open: DetailType | null;
  onClose: () => void;
  items?: ManagementFinanceItem[];
  asOf?: string;
  defaultMonth?: string;
  receivables?: ReceivableRow[];
  units?: UnitRow[];
  buildings?: BuildingRow[];
  customers?: CustomerRow[];
  locale: Locale;
}

const SOURCE_TYPE_LABELS: Record<string, { zh: string; fr: string }> = {
  daily_booking: { zh: "日租", fr: "Journalier" },
  lease_contract: { zh: "长租", fr: "Bail" },
  sale_contract: { zh: "售房", fr: "Vente" },
  manual: { zh: "手动", fr: "Manuel" },
  daily_rental: { zh: "日租房费", fr: "Sejour journalier" },
  lease_rent: { zh: "长租租金", fr: "Loyer longue duree" },
  lease_deposit: { zh: "长租押金", fr: "Depot location" },
  sale_installment: { zh: "出售分期", fr: "Echeance vente" },
  sale_lump_sum: { zh: "出售全款", fr: "Vente comptant" },
  other_income: { zh: "其他收入", fr: "Autre revenu" },
  other: { zh: "其他", fr: "Autre" },
};

const RECEIVABLE_STATUS_LABELS: Record<string, { zh: string; fr: string }> = {
  paid: { zh: "已收", fr: "Payé" },
  partial: { zh: "部分已收", fr: "Partiel" },
  pending: { zh: "待收", fr: "En attente" },
  overdue: { zh: "逾期", fr: "En retard" },
  cancelled: { zh: "已取消", fr: "Annulé" },
};

const PANEL_LABELS: Record<DetailType, { zh: { title: string; desc: string }; fr: { title: string; desc: string } }> = {
  receivable: {
    zh: { title: "应收明细", desc: "按月份查看长租、出售及历史应收款项" },
    fr: { title: "Du du mois", desc: "Creances dues ce mois" },
  },
  collected: {
    zh: { title: "已收明细", desc: "按月份查看已收款的长租、出售及历史应收项目" },
    fr: { title: "Encaisse sur les echeances du mois", desc: "Creances dues ce mois avec un montant encaisse" },
  },
  outstanding: {
    zh: { title: "未收明细", desc: "按月份查看尚未收齐的款项" },
    fr: { title: "Impaye du mois", desc: "Creances impayees ce mois" },
  },
  overdue: {
    zh: { title: "逾期明细", desc: "按月份查看已超过到期日仍未收齐的款项" },
    fr: { title: "Retard du mois", desc: "Creances en retard de paiement" },
  },
};

function getMonthKey(date: string | null | undefined) {
  const value = String(date ?? "");
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "";
}

function shiftMonth(monthKey: string, offset: number) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string, locale: Locale) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey;
  return locale === "zh" ? `${match[1]}年${Number(match[2])}月` : monthKey;
}

function summarizeItems(items: ManagementFinanceItem[]) {
  const totalReceivable = items.reduce((sum, item) => sum + item.amountXof, 0);
  const totalPaid = items.reduce((sum, item) => sum + item.paidAmountXof, 0);
  const outstanding = items.reduce((sum, item) => sum + item.outstandingXof, 0);
  const overdue = items
    .filter((item) => item.status === "overdue")
    .reduce((sum, item) => sum + item.outstandingXof, 0);
  return {
    totalReceivable,
    totalPaid,
    outstanding,
    overdue,
    count: items.length,
    collectionRate: totalReceivable > 0 ? totalPaid / totalReceivable : 0,
  };
}

function getMetricValue(type: DetailType, summary: ReturnType<typeof summarizeItems>) {
  if (type === "collected") return summary.totalPaid;
  if (type === "outstanding") return summary.outstanding;
  if (type === "overdue") return summary.overdue;
  return summary.totalReceivable;
}

export function FinanceDetailPanel({
  open, onClose, items, asOf, defaultMonth, receivables = [], units = [], buildings = [], customers = [], locale,
}: Props) {
  const t = dictionaries[locale].management;
  const todayStr = asOf || new Date().toISOString().slice(0, 10);
  const currentMonthPrefix = todayStr.slice(0, 7);
  const initialMonth = defaultMonth || currentMonthPrefix;
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);

  useEffect(() => {
    setSelectedMonth(initialMonth);
  }, [initialMonth, open]);

  const unitMap = useMemo(() => {
    const m = new Map<string, UnitRow>();
    for (const u of units) m.set(u.id, u);
    return m;
  }, [units]);

  const buildingMap = useMemo(() => {
    const m = new Map<string, BuildingRow>();
    for (const b of buildings) m.set(b.id, b);
    return m;
  }, [buildings]);

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerRow>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  const sourceItems = useMemo<ManagementFinanceItem[]>(() => {
    if (items) return items;

    return receivables
      .filter((r) =>
        r.source_type !== "daily_booking"
        && r.status !== "cancelled")
      .map((r) => {
        const unit = r.unit_id ? unitMap.get(r.unit_id) : undefined;
        const buildingId = r.building_id ?? unit?.building_id ?? null;
        const building = buildingId ? buildingMap.get(buildingId) : undefined;
        const amount = Math.max(Number(r.amount_xof), 0);
        const paid = Math.min(Math.max(Number(r.paid_amount_xof), 0), amount);
        const outstanding = Math.max(amount - paid, 0);
        const status: ManagementFinanceItem["status"] = outstanding <= 0
          ? "paid"
          : r.due_date < todayStr
            ? "overdue"
            : paid > 0 ? "partial" : "pending";

        return {
          id: r.id,
          dueDate: r.due_date,
          sourceType: r.source_type,
          category: r.category,
          title: r.title,
          amountXof: amount,
          paidAmountXof: paid,
          outstandingXof: outstanding,
          status,
          buildingId,
          buildingCode: building?.code ?? null,
          buildingName: building?.display_name ?? null,
          unitId: r.unit_id,
          unitNo: unit?.unit_no ?? null,
          customerId: r.customer_id,
          customerName: r.customer_id ? customerMap.get(r.customer_id)?.name ?? null : null,
        };
      });
  }, [items, receivables, todayStr, unitMap, buildingMap, customerMap]);

  const availableMonths = useMemo(() => {
    const months = new Set<string>([initialMonth]);
    for (const item of sourceItems) {
      const month = getMonthKey(item.dueDate);
      if (month) months.add(month);
    }
    return [...months].sort((a, b) => b.localeCompare(a));
  }, [initialMonth, sourceItems]);

  const selectedMonthItems = useMemo(
    () => sourceItems.filter((item) => getMonthKey(item.dueDate) === selectedMonth),
    [sourceItems, selectedMonth],
  );

  const selectedMonthSummary = useMemo(() => summarizeItems(selectedMonthItems), [selectedMonthItems]);
  const previousMonthSummary = useMemo(() => {
    const previousMonth = shiftMonth(selectedMonth, -1);
    return summarizeItems(sourceItems.filter((item) => getMonthKey(item.dueDate) === previousMonth));
  }, [sourceItems, selectedMonth]);

  const trendMonths = useMemo(() => {
    const seed = selectedMonth || initialMonth;
    return Array.from({ length: 6 }, (_, index) => shiftMonth(seed, index - 5));
  }, [initialMonth, selectedMonth]);

  const trend = useMemo(() => trendMonths.map((month) => {
    const summary = summarizeItems(sourceItems.filter((item) => getMonthKey(item.dueDate) === month));
    return {
      month,
      value: getMetricValue(open ?? "receivable", summary),
      rate: summary.collectionRate,
    };
  }), [open, sourceItems, trendMonths]);

  const receivableData = useMemo(() => {
    if (!open) return [];
    return selectedMonthItems
      .filter((item) => {
        if (open === "collected") return item.paidAmountXof > 0;
        if (open === "outstanding") return item.outstandingXof > 0;
        if (open === "overdue") return item.status === "overdue";
        return true;
      })
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  }, [open, selectedMonthItems]);

  if (!open) return null;

  const labels = PANEL_LABELS[open][locale === "fr" ? "fr" : "zh"];

  const totalReceivable = receivableData.reduce((sum, item) => sum + item.amountXof, 0);
  const totalPaid = receivableData.reduce((sum, item) => sum + item.paidAmountXof, 0);
  const selectedMetric = getMetricValue(open, selectedMonthSummary);
  const previousMetric = getMetricValue(open, previousMonthSummary);
  const delta = previousMetric > 0 ? (selectedMetric - previousMetric) / previousMetric : null;
  const trendMax = Math.max(...trend.map((point) => point.value), 1);

  const getBusinessTypeLabel = (sourceType: string, category?: string | null) => {
    const key = category || sourceType;
    const lang = locale === "fr" ? "fr" : "zh";
    return SOURCE_TYPE_LABELS[key]?.[lang] ?? SOURCE_TYPE_LABELS[sourceType]?.[lang] ?? key;
  };

  const getStatusLabel = (status: string) => {
    const lang = locale === "fr" ? "fr" : "zh";
    return RECEIVABLE_STATUS_LABELS[status]?.[lang] ?? status;
  };

  const getOverdueDays = (dueDate: string) =>
    Math.max(0, Math.floor(
      (new Date(`${todayStr}T00:00:00Z`).getTime() - new Date(`${dueDate}T00:00:00Z`).getTime())
      / (1000 * 60 * 60 * 24),
    ));

  return (
    <RightDrawer open title={labels.title} subtitle={labels.desc} onClose={onClose} width="table">
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">{locale === "zh" ? "统计月份" : "Mois"}</p>
                <div className="mt-2 flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-muted/70 p-1">
                  {availableMonths.slice(0, 12).map((month) => (
                    <button
                      key={month}
                      type="button"
                      onClick={() => setSelectedMonth(month)}
                      className={cn(
                        "shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors",
                        selectedMonth === month
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-card hover:text-foreground",
                      )}
                    >
                      {formatMonthLabel(month, locale)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid min-w-[320px] grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">{locale === "zh" ? "本月指标" : "Mois courant"}</p>
                  <p className="mt-1 font-semibold tabular-nums">{formatXof(selectedMetric)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">{locale === "zh" ? "上月同项" : "Mois precedent"}</p>
                  <p className="mt-1 font-semibold tabular-nums">{formatXof(previousMetric)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">{locale === "zh" ? "环比" : "Variation"}</p>
                  <p className={cn(
                    "mt-1 font-semibold tabular-nums",
                    delta == null ? "text-muted-foreground" : delta >= 0 ? "text-accentGreen-700" : "text-accentRed-600",
                  )}>
                    {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%`}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex h-20 items-end gap-2 border-t border-border/60 pt-3">
              {trend.map((point) => (
                <div key={point.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="flex h-12 w-full items-end justify-center">
                    <span
                      className={cn(
                        "block w-full max-w-10 rounded-t-md",
                        point.month === selectedMonth ? "bg-primary" : "bg-muted-foreground/25",
                      )}
                      style={{ height: `${Math.max(8, Math.round((point.value / trendMax) * 48))}px` }}
                    />
                  </div>
                  <span className="max-w-full truncate text-[11px] font-medium text-muted-foreground tabular-nums">
                    {formatMonthLabel(point.month, locale)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Summary bar */}
          <div className="flex flex-wrap gap-4 rounded-xl bg-muted/50 px-4 py-3 text-sm">
              <div>
                <span className="text-muted-foreground">{locale === "zh" ? "笔数" : "Nb"}: </span>
                <span className="font-semibold text-foreground">{receivableData.length}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{locale === "zh" ? "应收合计" : "Total du"}: </span>
                <span className="font-semibold text-foreground">{formatXof(totalReceivable)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{locale === "zh" ? "已收合计" : "Total encaisse"}: </span>
                <span className="font-semibold text-accentGreen-700">{formatXof(totalPaid)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{locale === "zh" ? "未收合计" : "Restant"}: </span>
                <span className={cn("font-semibold", totalReceivable - totalPaid > 0 ? "text-accentRed-700" : "text-foreground")}>
                  {formatXof(totalReceivable - totalPaid)}
                </span>
              </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="max-h-[calc(100vh-260px)] overflow-auto">
              {(
                <table className="w-full min-w-[1080px] text-left text-[13px]">
                  <thead className="sticky top-0 z-10 bg-muted/50">
                    <tr className="text-left text-xs font-semibold text-muted-foreground">
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "到期日" : "Echeance"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "楼栋" : "Bâtiment"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "房号" : "Chambre"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "客户" : "Client"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "业务" : "Type"}</th>
                      <th className="px-4 py-3 whitespace-nowrap text-right">{locale === "zh" ? "应收" : "Du"}</th>
                      <th className="px-4 py-3 whitespace-nowrap text-right">{locale === "zh" ? "已收" : "Encaisse"}</th>
                      <th className="px-4 py-3 whitespace-nowrap text-right">{locale === "zh" ? "未收" : "Impaye"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "状态" : "Statut"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {receivableData.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground/60">
                          {locale === "zh" ? "暂无数据" : "Aucune donnee"}
                        </td>
                      </tr>
                    ) : (
                      receivableData.map(r => {
                        const overdueDays = getOverdueDays(r.dueDate);
                        const buildingLabel = r.buildingCode && r.buildingName && r.buildingCode !== r.buildingName
                          ? `${r.buildingCode} · ${r.buildingName}`
                          : r.buildingName ?? r.buildingCode ?? "—";
                        return (
                          <tr key={r.id} className={cn(
                            "hover:bg-muted/50 transition-colors",
                            r.status === "overdue" && "bg-accentRed-50/30",
                            r.status === "partial" && "bg-amber-50/30",
                          )}>
                            <td className="px-4 py-2.5 whitespace-nowrap font-medium text-foreground">
                              {r.dueDate}
                              {r.status === "overdue" && (
                                <span className="ml-2 text-accentRed-500">
                                  {locale === "zh" ? `逾期${overdueDays}天` : `+${overdueDays}j`}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-foreground/70">
                              {buildingLabel}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-foreground/70">
                              {r.unitNo ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-foreground/70">
                              {r.customerName ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-foreground/60">
                              {getBusinessTypeLabel(r.sourceType, r.category)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold text-foreground">
                              {formatXof(r.amountXof)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right tabular-nums text-accentGreen-700">
                              {formatXof(r.paidAmountXof)}
                            </td>
                            <td className={cn("px-4 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold", r.outstandingXof > 0 ? "text-accentRed-600" : "text-muted-foreground/60")}>
                              {formatXof(r.outstandingXof)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLES[r.status] ?? "bg-muted text-foreground/70")}>
                                {getStatusLabel(r.status)}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
    </RightDrawer>
  );
}
