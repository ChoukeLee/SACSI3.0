"use client";

import { useMemo } from "react";
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
    zh: { title: "本月应收明细", desc: "到期日在本月的应收款项" },
    fr: { title: "Du du mois", desc: "Creances dues ce mois" },
  },
  collected: {
    zh: { title: "本月到期应收已收明细", desc: "到期日在本月且已收款的应收项目，并非仅按本月收款日期统计" },
    fr: { title: "Encaisse sur les echeances du mois", desc: "Creances dues ce mois avec un montant encaisse" },
  },
  outstanding: {
    zh: { title: "本月未收明细", desc: "本月到期但尚未收齐的款项" },
    fr: { title: "Impaye du mois", desc: "Creances impayees ce mois" },
  },
  overdue: {
    zh: { title: "本月逾期明细", desc: "已超过到期日仍未收齐的款项" },
    fr: { title: "Retard du mois", desc: "Creances en retard de paiement" },
  },
};

export function FinanceDetailPanel({
  open, onClose, items, asOf, receivables = [], units = [], buildings = [], customers = [], locale,
}: Props) {
  const t = dictionaries[locale].management;
  const todayStr = asOf || new Date().toISOString().slice(0, 10);
  const currentMonthPrefix = todayStr.slice(0, 7);

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
        && r.status !== "cancelled"
        && r.due_date.startsWith(currentMonthPrefix))
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
  }, [items, receivables, currentMonthPrefix, todayStr, unitMap, buildingMap, customerMap]);

  const receivableData = useMemo(() => {
    if (!open) return [];
    return sourceItems
      .filter((item) => {
        if (open === "collected") return item.paidAmountXof > 0;
        if (open === "outstanding") return item.outstandingXof > 0;
        if (open === "overdue") return item.status === "overdue";
        return true;
      })
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  }, [open, sourceItems]);

  if (!open) return null;

  const labels = PANEL_LABELS[open][locale === "fr" ? "fr" : "zh"];

  const totalReceivable = receivableData.reduce((sum, item) => sum + item.amountXof, 0);
  const totalPaid = receivableData.reduce((sum, item) => sum + item.paidAmountXof, 0);

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
