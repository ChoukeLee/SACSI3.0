import type { LeaseContractRow, PaymentRow, ReceivableRow } from "@/types/database";
import { leaseRentLabel, nativeLease, nativeReceivableSummary } from "@/lib/native-money";
import { formatMoney } from "@/lib/currency";

export function NativeLeaseFinance({ contract, payments, receivables, locale, today }: {
  contract: LeaseContractRow; payments: PaymentRow[]; receivables: ReceivableRow[];
  locale: "zh" | "fr"; today: string;
}) {
  if (!nativeLease(contract)) return null;
  const zh = locale === "zh", currency = contract.rent_currency!;
  const rows = receivables.filter((r) => r.source_id === contract.id);
  const summary = nativeReceivableSummary(rows, currency, today);
  const current = nativeReceivableSummary(rows.filter((r) => r.due_date <= today), currency, today);
  const received = payments.filter((p) => p.source_id === contract.id && p.native_settlement && p.currency === currency)
    .reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0) / 100;
  const money = (n: number) => `${formatMoney(n, currency, locale)} ${currency}`;
  return <section className="my-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-xs leading-6 dark:border-blue-900 dark:bg-blue-950/30" aria-label={zh ? "原币租金账务" : "Loyer en devise contractuelle"}>
    <p className="font-semibold">{zh ? "原币租金 · 不折算、不并入 XOF" : "Loyer en devise · hors XOF"}</p>
    <p>{zh ? "月租" : "Loyer mensuel"}：{leaseRentLabel(contract, locale)}</p>
    <p>{zh ? "已录租金收款" : "Loyers reçus inscrits"}：{money(received)}</p>
    <p>{zh ? "已建应收 / 已核销" : "Dû enregistré / imputé"}：{money(summary.total)} / {money(summary.paid)}</p>
    <p>{zh ? "当前到期未收 / 逾期" : "Échu restant / retard"}：{money(current.outstanding)} / {money(summary.overdue)}</p>
    <p>{zh ? "已建应收未收（含未来）" : "Restant enregistré (échéances futures incluses)"}：{money(summary.outstanding)}</p>
    <p>{zh ? "已缴至" : "Couvert jusqu’au"}：{contract.paid_through_date ?? "—"}</p>
  </section>;
}
