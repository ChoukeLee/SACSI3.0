"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { receivableStatusStyles as STATUS_STYLES } from "@/lib/status-styles";
import type {
  BuildingRow, UnitRow, ReceivableRow, CustomerRow,
} from "@/types/database";

type DetailType = "receivable" | "collected" | "outstanding" | "overdue";

interface Props {
  open: DetailType | null;
  onClose: () => void;
  receivables: ReceivableRow[];
  units: UnitRow[];
  buildings: BuildingRow[];
  customers: CustomerRow[];
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

const now = new Date();
const todayStr = now.toISOString().slice(0, 10);
const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

export function FinanceDetailPanel({
  open, onClose, receivables, units, buildings, customers, locale,
}: Props) {
  const t = dictionaries[locale].management;

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

  const receivableData = useMemo(() => {
    if (!open) return [];
    let filtered = receivables.filter(r => r.source_type !== "daily_booking");

    if (open === "receivable") {
      // 本月应收: due_date in current month, exclude cancelled
      filtered = filtered.filter(r => r.due_date.startsWith(currentMonthPrefix) && r.status !== "cancelled");
    } else if (open === "collected") {
      filtered = filtered.filter(r => r.due_date.startsWith(currentMonthPrefix) && r.status !== "cancelled" && Number(r.paid_amount_xof) > 0);
    } else if (open === "outstanding") {
      // 本月未收: due_date in current month, not paid/cancelled
      filtered = filtered.filter(r => r.due_date.startsWith(currentMonthPrefix) && r.status !== "paid" && r.status !== "cancelled");
    } else if (open === "overdue") {
      // 逾期: dynamic — any unpaid receivable past its due date
      filtered = filtered.filter(r => {
        if (r.status === "cancelled" || r.status === "paid") return false;
        return (Number(r.amount_xof) - Number(r.paid_amount_xof)) > 0 && r.due_date < todayStr;
      });
    }

    return filtered.sort((a, b) => b.due_date.localeCompare(a.due_date));
  }, [open, receivables]);

  if (!open) return null;

  const labels = PANEL_LABELS[open][locale === "fr" ? "fr" : "zh"];

  const totalReceivable = receivableData.reduce((s, r) => s + Number(r.amount_xof), 0);
  const totalPaid = receivableData.reduce((s, r) => s + Number(r.paid_amount_xof), 0);

  const getUnitInfo = (unitId: string | null) => {
    if (!unitId) return "—";
    const u = unitMap.get(unitId);
    return u ? `${u.unit_no}` : "—";
  };

  const getBuildingName = (buildingId: string | null) => {
    if (!buildingId) return "—";
    const b = buildingMap.get(buildingId);
    return b?.display_name ?? "—";
  };

  const getCustomerName = (customerId: string | null) => {
    if (!customerId) return "—";
    const c = customerMap.get(customerId);
    return c?.name ?? customerId.slice(0, 8);
  };

  const getBusinessTypeLabel = (sourceType: string, category?: string | null) => {
    const key = category || sourceType;
    const lang = locale === "fr" ? "fr" : "zh";
    return SOURCE_TYPE_LABELS[key]?.[lang] ?? SOURCE_TYPE_LABELS[sourceType]?.[lang] ?? key;
  };

  const getStatusLabel = (status: string) => {
    const lang = locale === "fr" ? "fr" : "zh";
    return RECEIVABLE_STATUS_LABELS[status]?.[lang] ?? status;
  };

  const getOverdueDays = (dueDate: string) => {
    const due = new Date(dueDate);
    return Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
  };

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 top-12 z-overlay bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-0 right-0 top-12 z-panel w-full max-w-full overflow-auto border-l border-border bg-card shadow-panel lg:max-w-5xl" role="dialog" aria-label={labels.title}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
          <div>
            <h3 className="text-sm font-medium tracking-tight text-foreground">{labels.title}</h3>
            <p className="text-xs text-muted-foreground">{labels.desc}</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={locale === "zh" ? "关闭" : "Fermer"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
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
                        const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof);
                        const overdueDays = getOverdueDays(r.due_date);
                        return (
                          <tr key={r.id} className={cn(
                            "hover:bg-muted/50 transition-colors",
                            r.status === "overdue" && "bg-accentRed-50/30",
                            r.status === "partial" && "bg-amber-50/30",
                          )}>
                            <td className="px-4 py-2.5 whitespace-nowrap font-medium text-foreground">
                              {r.due_date}
                              {r.status === "overdue" && (
                                <span className="ml-2 text-accentRed-500">
                                  {locale === "zh" ? `逾期${overdueDays}天` : `+${overdueDays}j`}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-foreground/70">
                              {getBuildingName(r.building_id ?? unitMap.get(r.unit_id ?? "")?.building_id ?? null)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-foreground/70">
                              {getUnitInfo(r.unit_id)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-foreground/70">
                              {getCustomerName(r.customer_id)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-foreground/60">
                              {getBusinessTypeLabel(r.source_type, r.category)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold text-foreground">
                              {formatXof(Number(r.amount_xof))}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right tabular-nums text-accentGreen-700">
                              {formatXof(Number(r.paid_amount_xof))}
                            </td>
                            <td className={cn("px-4 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold", outstanding > 0 ? "text-accentRed-600" : "text-muted-foreground/60")}>
                              {formatXof(outstanding)}
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
      </div>
    </>
  );
}
