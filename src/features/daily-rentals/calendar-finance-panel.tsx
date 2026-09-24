"use client";
import { X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import type { CustomerSummary } from "./customer-summary";
import { cn, formatXof } from "@/lib/utils";
import { calculateBilling } from "./billing";

export interface CalendarFinancePanelProps {
  financeDetail: "collected" | "outstanding" | "settled";
  locale: Locale;
  todayStr: string;
  financeStats: {
    monthCollected: number;
    currentOutstanding: number;
    monthSettled: number;
    collectedPayments: readonly unknown[];
    outstandingBookings: DailyBookingRow[];
    settledBookings: DailyBookingRow[];
  };
  collectedPaymentGroups: {
    id: string;
    paymentDates: string[];
    amount: number;
    count: number;
    stayRange: string;
    unit: UnitRow | null;
    customer: CustomerSummary | null;
  }[];
  allUnitById: ReadonlyMap<string, UnitRow>;
  customerMap: ReadonlyMap<string, CustomerSummary>;
  onClose: () => void;
  onOpenBooking: (bookingId: string) => void;
}

export function CalendarFinancePanel({
  financeDetail,
  locale,
  todayStr,
  financeStats,
  collectedPaymentGroups,
  allUnitById,
  customerMap,
  onClose,
  onOpenBooking,
}: CalendarFinancePanelProps) {
  return (
    <>
      <div
        className="absolute inset-0 z-overlay !mt-0 bg-black/30 backdrop-blur-sm"
        onClick={() => onClose()}
      />
      <div
        className="absolute inset-0 z-panel !mt-0 flex flex-col overflow-hidden border-l border-border bg-card shadow-panel"
        role="dialog"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
            <div>
              <h3 className="text-sm font-medium tracking-tight text-foreground">
                {financeDetail === "collected"
                  ? locale === "zh"
                    ? "本月已收明细"
                    : "Paiements du mois"
                  : financeDetail === "outstanding"
                    ? locale === "zh"
                      ? "当前未收明细"
                      : "Soldes impayés"
                    : locale === "zh"
                      ? "本月退房结账明细"
                      : "Règlements du mois"}
              </h3>
            </div>
            <button
              type="button"
              aria-label={locale === "zh" ? "关闭财务明细" : "Fermer le détail financier"}
              onClick={() => onClose()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-5 py-4 space-y-3">
            {/* Summary */}
            <div className="flex flex-wrap gap-4 rounded-xl bg-muted/50 px-4 py-3 text-sm">
              {financeDetail === "collected" && (
                <>
                  <div>
                    <span className="text-muted-foreground">
                      {locale === "zh" ? "笔数" : "Nb"}:{" "}
                    </span>
                    <span className="font-semibold">{financeStats.collectedPayments.length}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      {locale === "zh" ? "合计" : "Total"}:{" "}
                    </span>
                    <span className="font-semibold text-accentGreen-700">
                      {formatXof(financeStats.monthCollected)}
                    </span>
                  </div>
                </>
              )}
              {financeDetail === "outstanding" && (
                <>
                  <div>
                    <span className="text-muted-foreground">
                      {locale === "zh" ? "欠款笔数" : "Nb"}:{" "}
                    </span>
                    <span className="font-semibold">{financeStats.outstandingBookings.length}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      {locale === "zh" ? "欠款合计" : "Total"}:{" "}
                    </span>
                    <span className="font-semibold text-accentBlue-700">
                      {formatXof(financeStats.currentOutstanding)}
                    </span>
                  </div>
                </>
              )}
              {financeDetail === "settled" && (
                <>
                  <div>
                    <span className="text-muted-foreground">
                      {locale === "zh" ? "笔数" : "Nb"}:{" "}
                    </span>
                    <span className="font-semibold">{financeStats.settledBookings.length}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      {locale === "zh" ? "合计" : "Total"}:{" "}
                    </span>
                    <span className="font-semibold text-foreground">
                      {formatXof(financeStats.monthSettled)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="overflow-hidden">
                {financeDetail === "collected" && (
                  <table className="w-full table-fixed text-left text-[13px]">
                    <colgroup>
                      <col className="w-[20%]" />
                      <col className="w-[22%]" />
                      <col className="w-[10%]" />
                      <col className="w-[17%]" />
                      <col className="w-[8%]" />
                      <col className="w-[23%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-muted/50">
                      <tr className="text-left text-xs font-semibold text-muted-foreground">
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "收款日期" : "Date"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "居住日期" : "Sejour"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "房号" : "Chambre"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "经办人" : "Responsable"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap text-center">
                          {locale === "zh" ? "笔数" : "Nb"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap text-right">
                          {locale === "zh" ? "已收合计" : "Total encaisse"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {collectedPaymentGroups.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-3 py-10 text-center text-muted-foreground/70"
                          >
                            {locale === "zh" ? "本月暂无收款" : "Aucun paiement ce mois"}
                          </td>
                        </tr>
                      ) : (
                        collectedPaymentGroups.map((group) => {
                          const dates = Array.from(new Set(group.paymentDates)).sort();
                          const paymentDateLabel =
                            dates.length === 1
                              ? dates[0]
                              : `${dates[0]} / ${dates[dates.length - 1]}`;
                          return (
                            <tr key={group.id} className="hover:bg-muted/50">
                              <td className="px-3 py-2.5 whitespace-nowrap font-medium text-foreground">
                                {paymentDateLabel}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap text-foreground/80">
                                {group.stayRange}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap text-foreground/80">
                                {group.unit?.unit_no ?? "—"}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap text-foreground/80">
                                {group.customer?.name ?? "—"}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap text-center tabular-nums text-foreground/70">
                                {group.count}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold text-foreground">
                                {formatXof(group.amount)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                )}

                {financeDetail === "outstanding" && (
                  <table className="w-full table-fixed text-left text-[13px]">
                    <colgroup>
                      <col className="w-[7%]" />
                      <col className="w-[11%]" />
                      <col className="w-[16%]" />
                      <col className="w-[11%]" />
                      <col className="w-[17%]" />
                      <col className="w-[17%]" />
                      <col className="w-[21%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-muted/50">
                      <tr className="text-left text-xs font-semibold text-muted-foreground">
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "房号" : "Chambre"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "经办人" : "Responsable"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "入住备注" : "Note séjour"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "入住" : "Arrivee"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap text-right">
                          {locale === "zh" ? "应收" : "Du"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap text-right">
                          {locale === "zh" ? "已收" : "Encaisse"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap text-right">
                          {locale === "zh" ? "欠款" : "Impaye"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {financeStats.outstandingBookings.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-3 py-10 text-center text-muted-foreground/70"
                          >
                            {locale === "zh" ? "无未收款项" : "Aucun impaye"}
                          </td>
                        </tr>
                      ) : (
                        [...financeStats.outstandingBookings]
                          .sort((a, b) => {
                            const aOut = calculateBilling(a, todayStr).outstanding;
                            const bOut = calculateBilling(b, todayStr).outstanding;
                            if (bOut !== aOut) return bOut - aOut;
                            const dateCompare = a.check_in.localeCompare(b.check_in);
                            if (dateCompare !== 0) return dateCompare;
                            const aUnit = allUnitById.get(a.unit_id)?.unit_no ?? "";
                            const bUnit = allUnitById.get(b.unit_id)?.unit_no ?? "";
                            return aUnit.localeCompare(bUnit, undefined, { numeric: true });
                          })
                          .map((b) => {
                            const u = allUnitById.get(b.unit_id);
                            const c = customerMap.get(b.customer_id);
                            const billing = calculateBilling(b, todayStr);
                            return (
                              <tr key={b.id} className="hover:bg-muted/50">
                                <td className="px-3 py-2.5 whitespace-nowrap font-medium text-foreground">
                                  <button
                                    type="button"
                                    className="text-accentBlue-700 underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-label={
                                      locale === "zh"
                                        ? `查看房间${u?.unit_no ?? "—"}未结订单`
                                        : `Voir le séjour impayé ${u?.unit_no ?? "—"}`
                                    }
                                    onClick={() => onOpenBooking(b.id)}
                                  >
                                    {u?.unit_no ?? "—"}
                                  </button>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/80">
                                  {c?.name ?? "—"}
                                </td>
                                <td className="overflow-hidden px-3 py-2.5 text-foreground/80">
                                  <span className="block truncate" title={b.notes ?? undefined}>
                                    {b.notes || "—"}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/70">
                                  {b.check_in}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums text-foreground">
                                  {formatXof(billing.finalAmount)}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums text-accentGreen-700">
                                  {formatXof(billing.paid)}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold text-accentBlue-700">
                                  {formatXof(billing.outstanding)}
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                )}

                {financeDetail === "settled" && (
                  <table className="w-full table-fixed text-left text-[13px]">
                    <colgroup>
                      <col className="w-[7%]" />
                      <col className="w-[10%]" />
                      <col className="w-[14%]" />
                      <col className="w-[11%]" />
                      <col className="w-[11%]" />
                      <col className="w-[15%]" />
                      <col className="w-[15%]" />
                      <col className="w-[17%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-muted/50">
                      <tr className="text-left text-xs font-semibold text-muted-foreground">
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "房号" : "Chambre"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "经办人" : "Responsable"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "入住备注" : "Note séjour"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "入住" : "Arrivee"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap">
                          {locale === "zh" ? "退房" : "Depart"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap text-right">
                          {locale === "zh" ? "应收" : "Total"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap text-right">
                          {locale === "zh" ? "已收" : "Paye"}
                        </th>
                        <th className="px-3 py-3 whitespace-nowrap text-right">
                          {locale === "zh" ? "未收" : "Impaye"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {financeStats.settledBookings.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-3 py-10 text-center text-muted-foreground/70"
                          >
                            {locale === "zh" ? "本月暂无结算" : "Aucun reglement ce mois"}
                          </td>
                        </tr>
                      ) : (
                        [...financeStats.settledBookings]
                          .sort((a, b) => {
                            const aD = a.actual_check_out ?? a.check_out ?? "";
                            const bD = b.actual_check_out ?? b.check_out ?? "";
                            const dateCompare = bD.localeCompare(aD);
                            if (dateCompare !== 0) return dateCompare;
                            const aUnit = allUnitById.get(a.unit_id)?.unit_no ?? "";
                            const bUnit = allUnitById.get(b.unit_id)?.unit_no ?? "";
                            return aUnit.localeCompare(bUnit, undefined, { numeric: true });
                          })
                          .map((b) => {
                            const u = allUnitById.get(b.unit_id);
                            const c = customerMap.get(b.customer_id);
                            const billing = calculateBilling(b, todayStr);
                            return (
                              <tr key={b.id} className="hover:bg-muted/50">
                                <td className="px-3 py-2.5 whitespace-nowrap font-medium text-foreground">
                                  {u?.unit_no ?? "—"}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/80">
                                  {c?.name ?? "—"}
                                </td>
                                <td className="overflow-hidden px-3 py-2.5 text-foreground/80">
                                  <span className="block truncate" title={b.notes ?? undefined}>
                                    {b.notes || "—"}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/70">
                                  {b.check_in}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-foreground/70">
                                  {b.actual_check_out ?? b.check_out}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums text-foreground">
                                  {formatXof(billing.finalAmount)}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums text-accentGreen-700">
                                  {formatXof(billing.paid)}
                                </td>
                                <td
                                  className={cn(
                                    "px-3 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold",
                                    billing.outstanding > 0
                                      ? "text-rose-600"
                                      : "text-accentGreen-700",
                                  )}
                                >
                                  {billing.outstanding > 0
                                    ? formatXof(billing.outstanding)
                                    : locale === "zh"
                                      ? "已付清"
                                      : "Paye"}
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
      </div>
    </>
  );
}
