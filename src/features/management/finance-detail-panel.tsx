"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import type {
  BuildingRow, UnitRow, ReceivableRow, PaymentRow, CustomerRow,
} from "@/types/database";

type DetailType = "receivable" | "collected" | "outstanding" | "overdue";

interface Props {
  open: DetailType | null;
  onClose: () => void;
  receivables: ReceivableRow[];
  payments: PaymentRow[];
  units: UnitRow[];
  buildings: BuildingRow[];
  customers: CustomerRow[];
  locale: Locale;
}

const STATUS_STYLES: Record<string, string> = {
  pending:   "bg-slate-100 text-slate-700",
  partial:   "bg-brand-amber-100 text-brand-amber-700",
  paid:      "bg-brand-green-100 text-brand-green-700",
  overdue:   "bg-brand-red-100 text-brand-red-700",
  cancelled: "bg-slate-50 text-slate-400 line-through",
};

const SOURCE_TYPE_LABELS: Record<string, { zh: string; fr: string }> = {
  daily_booking: { zh: "日租", fr: "Journalier" },
  lease_contract: { zh: "长租", fr: "Bail" },
  sale_contract: { zh: "售房", fr: "Vente" },
  manual: { zh: "手动", fr: "Manuel" },
};

const PANEL_LABELS: Record<DetailType, { zh: { title: string; desc: string }; fr: { title: string; desc: string } }> = {
  receivable: {
    zh: { title: "本月应收明细", desc: "到期日在本月的应收款项" },
    fr: { title: "Du du mois", desc: "Creances dues ce mois" },
  },
  collected: {
    zh: { title: "本月实收明细", desc: "本月实际收到的款项" },
    fr: { title: "Encaisse du mois", desc: "Paiements recus ce mois" },
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
const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

export function FinanceDetailPanel({
  open, onClose, receivables, payments, units, buildings, customers, locale,
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
    if (!open || open === "collected") return [];
    let filtered = receivables;

    if (open === "receivable") {
      // 本月应收: due_date in current month, exclude cancelled
      filtered = receivables.filter(r => r.due_date.startsWith(currentMonthPrefix) && r.status !== "cancelled");
    } else if (open === "outstanding") {
      // 本月未收: due_date in current month, not paid/cancelled
      filtered = receivables.filter(r => r.due_date.startsWith(currentMonthPrefix) && r.status !== "paid" && r.status !== "cancelled");
    } else if (open === "overdue") {
      // 逾期: status = overdue
      filtered = receivables.filter(r => r.status === "overdue");
    }

    return filtered.sort((a, b) => b.due_date.localeCompare(a.due_date));
  }, [open, receivables]);

  const paymentData = useMemo(() => {
    if (open !== "collected") return [];

    const currentMonthPayments = payments.filter(p => p.payment_date.startsWith(currentMonthPrefix));

    // Build a set of receivable source_ids for lookups
    const receivableSourceIds = new Set(receivables.map(r => r.source_id).filter(Boolean));

    return currentMonthPayments
      .filter(p => receivableSourceIds.has(p.source_id) || p.source_type !== "daily_booking")
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  }, [open, payments, receivables]);

  if (!open) return null;

  const labels = PANEL_LABELS[open][locale === "fr" ? "fr" : "zh"];

  const totalReceivable = receivableData.reduce((s, r) => s + Number(r.amount_xof), 0);
  const totalPaid = receivableData.reduce((s, r) => s + Number(r.paid_amount_xof), 0);
  const totalPaymentAmount = paymentData.reduce((s, p) => s + Number(p.amount), 0);

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

  const getSourceTypeLabel = (sourceType: string) => {
    return SOURCE_TYPE_LABELS[sourceType]?.[locale === "fr" ? "fr" : "zh"] ?? sourceType;
  };

  const getOverdueDays = (dueDate: string) => {
    const due = new Date(dueDate);
    return Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
  };

  return (
    <>
      <div className="fixed inset-0 z-overlay bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-panel w-full max-w-full overflow-auto border-l border-slate-200 bg-white shadow-panel lg:max-w-2xl" role="dialog" aria-label={labels.title}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <h3 className="text-sm font-black text-slate-950">{labels.title}</h3>
            <p className="text-xs text-slate-500">{labels.desc}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={locale === "zh" ? "关闭" : "Fermer"}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Summary bar */}
          {open !== "collected" && (
            <div className="flex flex-wrap gap-4 rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <div>
                <span className="text-slate-500">{locale === "zh" ? "笔数" : "Nb"}: </span>
                <span className="font-black text-slate-950">{receivableData.length}</span>
              </div>
              <div>
                <span className="text-slate-500">{locale === "zh" ? "应收合计" : "Total du"}: </span>
                <span className="font-black text-slate-950">{formatXof(totalReceivable)}</span>
              </div>
              <div>
                <span className="text-slate-500">{locale === "zh" ? "已收合计" : "Total encaisse"}: </span>
                <span className="font-black text-brand-green-700">{formatXof(totalPaid)}</span>
              </div>
              <div>
                <span className="text-slate-500">{locale === "zh" ? "未收合计" : "Restant"}: </span>
                <span className={cn("font-black", totalReceivable - totalPaid > 0 ? "text-brand-red-700" : "text-slate-950")}>
                  {formatXof(totalReceivable - totalPaid)}
                </span>
              </div>
            </div>
          )}

          {open === "collected" && (
            <div className="flex flex-wrap gap-4 rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <div>
                <span className="text-slate-500">{locale === "zh" ? "笔数" : "Nb"}: </span>
                <span className="font-black text-slate-950">{paymentData.length}</span>
              </div>
              <div>
                <span className="text-slate-500">{locale === "zh" ? "收款合计" : "Total encaisse"}: </span>
                <span className="font-black text-brand-green-700">{formatXof(totalPaymentAmount)}</span>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="max-h-[calc(100vh-260px)] overflow-auto">
              {open !== "collected" ? (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="text-left text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "到期日" : "Echeance"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "房号" : "Chambre"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "客户" : "Client"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "业务" : "Type"}</th>
                      <th className="px-4 py-3 whitespace-nowrap text-right">{locale === "zh" ? "应收" : "Du"}</th>
                      <th className="px-4 py-3 whitespace-nowrap text-right">{locale === "zh" ? "已收" : "Encaisse"}</th>
                      <th className="px-4 py-3 whitespace-nowrap text-right">{locale === "zh" ? "未收" : "Impaye"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "状态" : "Statut"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {receivableData.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                          {locale === "zh" ? "暂无数据" : "Aucune donnee"}
                        </td>
                      </tr>
                    ) : (
                      receivableData.map(r => {
                        const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof);
                        const overdueDays = getOverdueDays(r.due_date);
                        return (
                          <tr key={r.id} className={cn(
                            "hover:bg-slate-50 transition-colors",
                            r.status === "overdue" && "bg-brand-red-50/30",
                            r.status === "partial" && "bg-brand-amber-50/30",
                          )}>
                            <td className="px-4 py-2.5 whitespace-nowrap font-medium text-slate-900">
                              {r.due_date}
                              {r.status === "overdue" && (
                                <span className="ml-2 text-brand-red-500">+{overdueDays}j</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                              {getUnitInfo(r.unit_id)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                              {getCustomerName(r.customer_id)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                              {getSourceTypeLabel(r.source_type)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right font-semibold text-slate-900">
                              {formatXof(Number(r.amount_xof))}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right text-brand-green-700">
                              {formatXof(Number(r.paid_amount_xof))}
                            </td>
                            <td className={cn("px-4 py-2.5 whitespace-nowrap text-right font-semibold", outstanding > 0 ? "text-brand-red-600" : "text-slate-400")}>
                              {formatXof(outstanding)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-700")}>
                                {r.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="text-left text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "收款日期" : "Date"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "房号" : "Chambre"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "客户" : "Client"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "业务" : "Type"}</th>
                      <th className="px-4 py-3 whitespace-nowrap text-right">{locale === "zh" ? "金额" : "Montant"}</th>
                      <th className="px-4 py-3 whitespace-nowrap">{locale === "zh" ? "收据号" : "Recu"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paymentData.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                          {locale === "zh" ? "暂无数据" : "Aucune donnee"}
                        </td>
                      </tr>
                    ) : (
                      paymentData.map(p => (
                        <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap font-medium text-slate-900">
                            {p.payment_date}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                            {getUnitInfo(p.unit_id)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                            {getCustomerName(p.customer_id)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                            {getSourceTypeLabel(p.source_type)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right font-semibold text-slate-900">
                            {formatXof(Number(p.amount))}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                            {p.receipt_no ?? "—"}
                          </td>
                        </tr>
                      ))
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
