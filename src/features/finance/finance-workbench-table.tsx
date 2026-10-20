"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/currency";
import { financeRowMoney } from "@/lib/native-money";
import {
  directionDisplayLabel,
  financialBusinessLabel,
  statusDisplayLabel,
} from "@/lib/display-labels";
import type { FinanceReadResult } from "./finance-read";
import {
  financeManagedOutstanding,
  financeWorkbenchHref,
  type FinanceWorkbenchQuery,
} from "./finance-workbench-model";
import styles from "./finance-workbench.module.css";

export interface FinanceWorkbenchTableProps {
  result: FinanceReadResult;
  query: FinanceWorkbenchQuery;
  locale: "zh" | "fr";
  today: string;
  pending: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPageNavigate: () => void;
}

/** Pure paged presentation: summaries and selection lifetime remain in the workspace. */
export function FinanceWorkbenchTable({
  result,
  query,
  locale,
  today,
  pending,
  selectedId,
  onSelect,
  onPageNavigate,
}: FinanceWorkbenchTableProps) {
  const ledger = query.kind === "ledger";
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  return (
    <>
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <caption className="sr-only">
            {ledger
              ? text(
                  "收支分录；金额单位 XOF，点击款项查看付款事实。",
                  "Écritures en XOF ; sélectionner un objet pour les faits du paiement.",
                )
              : text(
                  "应收明细；金额单位 XOF，已核销不等于现金实收。",
                  "Créances en XOF ; les imputations ne sont pas des encaissements.",
                )}
          </caption>
          <thead>
            <tr>
              <th>
                {ledger
                  ? text("款项 / 流水日期", "Objet / date d’écriture")
                  : text("事项 / 到期日", "Objet / échéance")}
              </th>
              <th>{text("业务对象", "Lot / activité")}</th>
              <th className={styles.amount}>
                {ledger
                  ? text("分录金额 / 币种", "Écriture / devise")
                  : text("未收 / 应收 / 币种", "Restant / dû / devise")}
              </th>
              <th className={styles.rowAction}>
                <span className="sr-only">{text("详情", "Détail")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => {
              const value = financeRowMoney(row);
              const money = (amount: number) =>
                `${formatMoney(amount, value.currency, locale)}${value.currency === "XOF" ? "" : ` ${value.currency}`}`;
              const balance = ledger ? null : financeManagedOutstanding(row);
              const overdue =
                !ledger &&
                balance !== null &&
                balance > 0 &&
                String(row.due_date) < today &&
                row.status !== "paid";
              return (
                <tr key={String(row.id)} data-selected={selectedId === row.id || undefined}>
                  <td>
                    <button
                      type="button"
                      className={styles.rowLink}
                      disabled={pending}
                      onClick={() => onSelect(String(row.id))}
                      aria-label={`${text("查看账目", "Voir l’écriture")} ${row.id}`}
                    >
                      {financialBusinessLabel(String(row.category), locale)}
                    </button>
                    <span className={styles.cellSub}>
                      {String(row[ledger ? "entry_date" : "due_date"])}
                      {!ledger && (
                        <span className={`${styles.badge} ${overdue ? styles.danger : ""}`}>
                          {overdue
                            ? text("按到期日已逾期", "Échéance dépassée")
                            : statusDisplayLabel(String(row.status), locale)}
                        </span>
                      )}
                    </span>
                    <span className={styles.description}>
                      {String((ledger ? row.description : row.title) || "—")}
                    </span>
                  </td>
                  <td>
                    <span className={styles.cellMain}>
                      {row.unit_label || text("无关联房号", "Sans lot lié")}
                    </span>
                    <span className={styles.cellSub}>
                      {row.building_label || text("楼栋待核对", "Bâtiment à vérifier")}
                    </span>
                    {!ledger && row.management_status !== "managed" && (
                      <span className={styles.badge}>
                        {row.management_status === "historical_pending"
                          ? text("历史待核对", "Historique à vérifier")
                          : text("非系统管理应收", "Hors créances gérées")}
                      </span>
                    )}
                  </td>
                  <td className={styles.amount}>
                    <span className={styles.money}>
                      {ledger ? money(value.amount) : balance === null ? "—" : money(balance)}
                    </span>
                    <span className={styles.cellSub}>
                      {ledger
                        ? directionDisplayLabel(String(row.direction), locale)
                        : `${text("登记应收", "Dû enregistré")} ${money(value.amount)}`}
                    </span>
                    {ledger && String(row.direction).startsWith("liability") && (
                      <span className={styles.badge}>
                        {text("负债 · 非收入", "Passif · pas un revenu")}
                      </span>
                    )}
                    {!ledger && (
                      <span className={styles.cellSub}>
                        {text("已核销", "Imputé")} {money(financeRowMoney(row, true).amount)}
                      </span>
                    )}
                  </td>
                  <td className={styles.rowAction}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      disabled={pending}
                      aria-label={`${text("展开账目", "Ouvrir le détail")} ${row.id}`}
                      onClick={() => onSelect(String(row.id))}
                    >
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!result.rows.length && (
        <div className={styles.empty}>
          {text("没有匹配记录。请调整筛选条件。", "Aucun résultat. Ajustez les filtres.")}
        </div>
      )}
      <div className={styles.tableFooter}>
        <span>
          {result.rows.length
            ? `${(query.page - 1) * 50 + 1}–${(query.page - 1) * 50 + result.rows.length} / ${result.total}`
            : `0 / ${result.total}`}{" "}
          {text("条", "lignes")}
        </span>
        <nav aria-label={text("账目分页", "Pagination financière")}>
          {query.page > 1 ? (
            <Link
              href={financeWorkbenchHref(query, locale, query.kind, {
                page: String(query.page - 1),
              })}
              prefetch={false}
              aria-label={text("上一页", "Page précédente")}
              onClick={onPageNavigate}
            >
              <ChevronLeft size={15} />
            </Link>
          ) : (
            <button aria-label={text("上一页", "Page précédente")} disabled>
              <ChevronLeft size={15} />
            </button>
          )}
          <span>
            {query.page} / {Math.max(1, Math.ceil(result.total / 50))}
          </span>
          {query.page * 50 < result.total ? (
            <Link
              href={financeWorkbenchHref(query, locale, query.kind, {
                page: String(query.page + 1),
              })}
              prefetch={false}
              aria-label={text("下一页", "Page suivante")}
              onClick={onPageNavigate}
            >
              <ChevronRight size={15} />
            </Link>
          ) : (
            <button aria-label={text("下一页", "Page suivante")} disabled>
              <ChevronRight size={15} />
            </button>
          )}
        </nav>
      </div>
    </>
  );
}
