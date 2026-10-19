"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatContractXof,
  sortContractRows,
  type ContractTableRow,
  type ContractSort,
} from "@/features/contracts/contract-list-model";
import { contractStatusVariant } from "@/lib/status-styles";
import type { Locale } from "@/lib/i18n";
import styles from "./sale-workbench.module.css";

export function SaleWorkbenchTable({
  rows,
  locale,
  selectedId,
  onSelect,
  toolbar,
  pagination,
  onNavigate,
}: {
  rows: ContractTableRow[];
  locale: Locale;
  selectedId: string | null;
  onSelect: (id: string) => void;
  toolbar: ReactNode;
  onNavigate?: () => void;
  pagination?: {
    page: number;
    total: number;
    pageSize: number;
    sort: ContractSort;
    onPageChange: (page: number) => void;
    onSortChange: (key: ContractSort["key"], direction: "asc" | "desc") => void;
  };
}) {
  const zh = locale === "zh";
  const [localSort, setLocalSort] = useState<ContractSort>({ key: "unit", direction: "asc" });
  const [localPage, setLocalPage] = useState(1);
  const sort = pagination?.sort ?? localSort;
  const sorted = useMemo(
    () => (pagination ? rows : sortContractRows(rows, sort)),
    [rows, pagination, sort],
  );
  const total = pagination?.total ?? rows.length,
    size = pagination?.pageSize ?? 25;
  const pages = Math.max(1, Math.ceil(total / size)),
    page = pagination?.page ?? Math.min(localPage, pages);
  const visible = pagination ? rows : sorted.slice((page - 1) * size, page * size);
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const money = (value: number | null) =>
    value === null ? text("未核", "À vérifier") : formatContractXof(value, locale);
  const changePage = (value: number) => {
    onNavigate?.();
    if (pagination) pagination.onPageChange(value);
    else setLocalPage(value);
  };
  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"
      aria-label={text("出售合同清单", "Liste des ventes")}
    >
      {toolbar}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
        <span className={styles.note}>
          {text(
            "选中合同，核对分期、实收与过户",
            "Sélectionnez un contrat pour vérifier ses échéances et son transfert",
          )}
        </span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {text("排序", "Trier")}
          <select
            aria-label={text("出售合同排序", "Tri des ventes")}
            className="max-w-44 rounded-md border bg-card px-2 py-1.5 text-xs"
            value={`${sort.key}:${sort.direction}`}
            onChange={(event) => {
              onNavigate?.();
              const [key, direction] = event.target.value.split(":") as [
                ContractSort["key"],
                "asc" | "desc",
              ];
              if (pagination) pagination.onSortChange(key, direction);
              else {
                setLocalSort({ key, direction });
                setLocalPage(1);
              }
            }}
          >
            {(
              [
                ["unit", text("房号", "Lot")],
                ["customer", text("买方", "Acheteur")],
                ["period", text("签约日期", "Signature")],
                ["amount", text("合同价", "Prix")],
                ["balance", text("应收未收", "Créances restantes")],
                ["status", text("状态", "Statut")],
              ] as const
            ).flatMap(([key, label]) =>
              ["asc", "desc"].map((direction) => (
                <option key={`${key}:${direction}`} value={`${key}:${direction}`}>
                  {label} ·{" "}
                  {direction === "asc" ? text("升序", "croissant") : text("降序", "décroissant")}
                </option>
              )),
            )}
          </select>
        </label>
      </div>
      <table className={styles.table}>
        <caption className="sr-only">
          {text(
            "出售合同，所有汇总金额均为 XOF。选中合同后读取其详情。",
            "Contrats de vente, montants de synthèse en XOF. Les détails sont chargés à la sélection.",
          )}
        </caption>
        <thead>
          <tr>
            <th scope="col">{text("房源 / 合同", "Lot / contrat")}</th>
            <th scope="col">{text("买方 / 签约", "Acheteur / signature")}</th>
            <th scope="col">{text("合同价", "Prix contractuel")}</th>
            <th scope="col">{text("履约状态", "Exécution")}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.id} data-selected={row.id === selectedId ? "true" : undefined}>
              <td>
                <button
                  type="button"
                  className={styles.tableButton}
                  aria-pressed={row.id === selectedId}
                  onClick={() => onSelect(row.id)}
                  aria-label={`${text("预览出售合同", "Aperçu de vente")} ${row.building} ${row.unit}`}
                >
                  {row.unit}
                </button>
                <p className={styles.sub}>{row.building}</p>
                <p className={styles.sub}>{row.contractNo || text("编号待补", "N° à compléter")}</p>
              </td>
              <td>
                <button
                  type="button"
                  className="text-left text-sm font-medium hover:underline"
                  onClick={() => onSelect(row.id)}
                >
                  {row.customer}
                </button>
                <p className={styles.sub}>{row.periodLabel}</p>
                {row.needsReview ? (
                  <p className={`${styles.sub} ${styles.alert}`}>
                    {text("资料待核对", "Dossier à vérifier")}
                  </p>
                ) : null}
              </td>
              <td>
                <p className={styles.money}>{money(row.amountXof)}</p>
                {row.amountDetail && row.amountDetail !== "XOF" && (
                  <p className={styles.sub}>{row.amountDetail}</p>
                )}
              </td>
              <td>
                <Badge variant={contractStatusVariant[row.status] ?? "secondary"}>
                  {row.statusLabel}
                </Badge>
                <p className={styles.sub}>{row.secondaryLabel}</p>
                <p className={styles.sub}>
                  {text("应收未收", "Créances restantes")}{" "}
                  <span className={row.balanceOverdue ? styles.alert : styles.money}>
                    {money(row.balanceXof)}
                  </span>
                </p>
                <p className={styles.sub}>{row.balanceDetail}</p>
              </td>
            </tr>
          ))}
          {!visible.length ? (
            <tr>
              <td colSpan={4}>
                <div className={styles.empty}>
                  {text(
                    "没有匹配的出售合同，试试调整范围或搜索。",
                    "Aucune vente correspondante. Ajustez les filtres ou la recherche.",
                  )}
                </div>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <footer className={styles.tableFooter}>
        <div>
          <p aria-live="polite">
            {total ? `${(page - 1) * size + 1}–${Math.min(page * size, total)} / ${total}` : "0"}{" "}
            {text("份合同", "contrats")}
          </p>
          <p className="mt-1">
            {text(
              "合同价 ≠ 现金实收 · 应收核销单独核对",
              "Prix ≠ encaissements · rapprochements distincts",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => changePage(page - 1)}
          >
            {text("上一页", "Précédent")}
          </Button>
          <span>
            {page} / {pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pages}
            onClick={() => changePage(page + 1)}
          >
            {text("下一页", "Suivant")}
          </Button>
        </div>
      </footer>
    </section>
  );
}
