import { formatMoney } from "@/lib/currency";
import type { NativeCurrencySummary } from "@/lib/native-money";

export function NativeCurrencySummaryPanel({ rows, kind, locale }: {
  rows?: NativeCurrencySummary[];
  kind: "ledger" | "receivables";
  locale: "zh" | "fr";
}) {
  if (!rows?.length) return null;
  const zh = locale === "zh";
  return <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 text-sm dark:border-blue-900 dark:bg-blue-950/30" aria-label={zh ? "原币独立统计" : "Totaux en devises séparées"}>
    <p className="font-medium">{zh ? "原币独立统计 · 不并入 XOF 合计" : "Devises séparées · hors totaux XOF"}</p>
    {rows.map((row) => <p key={row.currency} className="mt-2 tabular-nums">
      <strong>{row.currency}</strong>{" · "}
      {kind === "ledger"
        ? `${zh ? "收入分录" : "Revenus inscrits"} ${formatMoney(row.income, row.currency, locale)} · ${zh ? "费用" : "Dépenses"} ${formatMoney(row.expense, row.currency, locale)} · ${zh ? "押金流入 / 流出" : "Dépôts entrants / sortants"} ${formatMoney(row.liability_in, row.currency, locale)} / ${formatMoney(row.liability_out, row.currency, locale)}`
        : `${zh ? "应收 / 已核销 / 未收 / 逾期" : "Dû / imputé / restant / retard"} ${[row.receivable, row.paid, row.outstanding, row.overdue].map((n) => formatMoney(n, row.currency, locale)).join(" / ")}`}
    </p>)}
  </section>;
}
