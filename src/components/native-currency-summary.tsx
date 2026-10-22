import { formatMoney } from "@/lib/currency";
import type { NativeCurrencySummary } from "@/lib/native-money";
import { ChevronRight } from "lucide-react";
import styles from "./native-currency-summary.module.css";

type SummaryKind = "ledger" | "receivables" | "operating";
type Metric = readonly [Exclude<keyof NativeCurrencySummary, "currency">, string];

export function NativeCurrencySummaryPanel({
  rows,
  kind,
  locale,
}: {
  rows?: NativeCurrencySummary[];
  kind: SummaryKind;
  locale: "zh" | "fr";
}) {
  if (!rows?.length) return null;
  const zh = locale === "zh";
  const receivables: Metric[] = [
    ["receivable", zh ? "应收" : "Dû"],
    ["paid", zh ? "已核销" : "Imputé"],
    ["outstanding", zh ? "未收" : "Restant"],
    ["overdue", zh ? "其中逾期" : "Dont en retard"],
  ];
  // The operating snapshot only supplies native receipts and current receivables,
  // not a complete native ledger or a native-currency trend.
  const metrics: Metric[] =
    kind === "ledger"
      ? [
          ["income", zh ? "收入分录" : "Revenus inscrits"],
          ["expense", zh ? "费用" : "Dépenses"],
          ["liability_in", zh ? "押金流入" : "Dépôts entrants"],
          ["liability_out", zh ? "押金流出" : "Dépôts sortants"],
        ]
      : kind === "operating"
        ? [["income", zh ? "本月原币收款" : "Encaissements en devise du mois"], ...receivables]
        : receivables;
  const preferred =
    kind === "operating"
      ? ["income", "outstanding"]
      : kind === "receivables"
        ? ["outstanding", "overdue"]
        : ["income", "expense"];

  return (
    <details
      className={styles.root}
      aria-label={zh ? "原币独立统计" : "Totaux en devises séparées"}
      data-native-currency-summary={kind}
    >
      <summary className={styles.trigger}>
        <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
        <span className={styles.title}>{zh ? "其他币种" : "Autres devises"}</span>
        <span className={styles.preview}>
          {rows.map((row) => {
            const nonzero = metrics.filter(([key]) => row[key] !== 0);
            const highlights = nonzero.filter(([key]) => preferred.includes(key));
            // Keep settled history accessible, but don't fill the collapsed row with zeros.
            const fallback =
              kind === "receivables"
                ? nonzero.filter(([key]) => key === (row.paid !== 0 ? "paid" : "receivable"))
                : nonzero.slice(0, 2);
            const visible = highlights.length || kind === "operating" ? highlights : fallback;
            return (
              <span key={row.currency} className={styles.currencyPreview}>
                <strong>{row.currency}</strong>
                {visible.map(([key, label]) => (
                  <span key={key}>
                    {kind === "operating" && key === "income"
                      ? zh
                        ? "本月收款"
                        : "Ce mois"
                      : label}{" "}
                    <span className={styles.amount}>
                      {formatMoney(row[key], row.currency, locale)}
                    </span>
                  </span>
                ))}
              </span>
            );
          })}
        </span>
        <span className={styles.hint}>{zh ? "查看明细" : "Détails"}</span>
      </summary>
      <div className={styles.body}>
        <p className={styles.note}>
          {kind === "operating"
            ? zh
              ? "收款按本月，应收与核销为截至今日已到期记录的当前状态；不代表完整原币现金流。各币种独立，不折算或并入 XOF 合计。"
              : "Encaissements du mois et état actuel des créances arrivées à échéance à ce jour ; pas un flux complet en devises. Devises séparées, sans conversion ni ajout aux totaux XOF."
            : zh
              ? "与当前筛选范围一致，各币种独立统计，不折算或并入 XOF 合计。"
              : "Même périmètre que les filtres appliqués. Devises séparées, sans conversion ni ajout aux totaux XOF."}
        </p>
        {rows.map((row) => (
          <div key={row.currency} className={styles.currencyDetail}>
            <h3>{row.currency}</h3>
            <dl className={styles.metrics}>
              {metrics.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{formatMoney(row[key], row.currency, locale)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </details>
  );
}
