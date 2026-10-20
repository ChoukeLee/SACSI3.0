"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, DollarSign, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatContractXof,
  sortContractRows,
  type ContractSort,
  type ContractSortKey,
  type ContractTableRow,
} from "@/features/contracts/contract-list-model";
import type { Locale } from "@/lib/i18n";
import { contractStatusVariant } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

export interface LeaseWorkbenchTableProps {
  rows: ContractTableRow[];
  locale: Locale;
  amountLabel: string;
  periodLabel: string;
  toolbar?: ReactNode;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onFinance: (id: string) => void;
  onPrint: (id: string) => void;
  onVisibleIdsChange?: (ids: string[]) => void;
  pagination?: {
    page: number;
    total: number;
    pageSize: number;
    sort: ContractSort;
    onPageChange: (page: number) => void;
    onSortChange: (key: ContractSortKey, direction: "asc" | "desc") => void;
  };
}

// The list can share a row with a contract preview. Container queries respond to
// its actual available width instead of the width of the browser window.
const TABLE_STYLES = `
  .lease-workbench-table { container-name: lease-contracts; container-type: inline-size; }
  .lease-workbench-table table { table-layout: fixed; }
  .lease-workbench-table th, .lease-workbench-table td { overflow-wrap: anywhere; }
  .lease-workbench-table [data-col="unit"] { width: 15%; }
  .lease-workbench-table [data-col="customer"] { width: 18%; }
  .lease-workbench-table [data-col="period"] { width: 20%; }
  .lease-workbench-table [data-col="amount"] { width: 13%; }
  .lease-workbench-table [data-col="balance"] { width: 14%; }
  .lease-workbench-table [data-col="status"] { width: 10%; }
  .lease-workbench-table [data-col="actions"] { width: 10%; }
  .lease-workbench-table [data-compact] { display: none; }
  @container lease-contracts (max-width: 839px) {
    .lease-workbench-table [data-col="amount"] { display: none; }
    .lease-workbench-table [data-compact="amount"] { display: block; }
    .lease-workbench-table [data-col="unit"] { width: 17%; }
    .lease-workbench-table [data-col="customer"] { width: 25%; }
    .lease-workbench-table [data-col="period"] { width: 23%; }
    .lease-workbench-table [data-col="balance"] { width: 17%; }
    .lease-workbench-table [data-col="status"] { width: 10%; }
    .lease-workbench-table [data-col="actions"] { width: 8%; }
    .lease-workbench-table [data-row-actions] { flex-direction: column; align-items: flex-end; }
  }
  @container lease-contracts (max-width: 699px) {
    .lease-workbench-table [data-col="period"] { display: none; }
    .lease-workbench-table [data-compact="period"] { display: block; }
    .lease-workbench-table [data-col="unit"] { width: 19%; }
    .lease-workbench-table [data-col="customer"] { width: 44%; }
    .lease-workbench-table [data-col="balance"] { width: 19%; }
    .lease-workbench-table [data-col="status"] { width: 11%; }
    .lease-workbench-table [data-col="actions"] { width: 7%; }
  }
  @container lease-contracts (max-width: 519px) {
    .lease-workbench-table [data-col="balance"],
    .lease-workbench-table [data-col="status"] { display: none; }
    .lease-workbench-table [data-compact="balance"],
    .lease-workbench-table [data-compact="status"] { display: block; }
    .lease-workbench-table [data-col="unit"] { width: 27%; }
    .lease-workbench-table [data-col="customer"] { width: 56%; }
    .lease-workbench-table [data-col="actions"] { width: 17%; }
  }
  @media (pointer: coarse) {
    .lease-workbench-table button, .lease-workbench-table select { min-height: 44px; }
    .lease-workbench-table [data-row-actions] { flex-direction: column; align-items: flex-end; }
    .lease-workbench-table [data-row-actions] button { min-width: 44px; min-height: 44px; }
    .lease-workbench-table [data-contract-link] { min-height: 44px; }
    @container lease-contracts (max-width: 839px) {
      .lease-workbench-table [data-col="customer"] { width: 25%; }
      .lease-workbench-table [data-col="period"] { width: 22%; }
      .lease-workbench-table [data-col="balance"] { width: 16%; }
      .lease-workbench-table [data-col="actions"] { width: 10%; }
    }
    @container lease-contracts (max-width: 699px) {
      .lease-workbench-table [data-col="customer"] { width: 40%; }
      .lease-workbench-table [data-col="balance"] { width: 19%; }
      .lease-workbench-table [data-col="actions"] { width: 11%; }
    }
    @container lease-contracts (max-width: 519px) {
      .lease-workbench-table [data-col="customer"] { width: 53%; }
      .lease-workbench-table [data-col="actions"] { width: 20%; }
    }
  }
`;

export function LeaseWorkbenchTable({
  rows,
  locale,
  amountLabel,
  periodLabel,
  toolbar,
  selectedId,
  onSelect,
  onOpen,
  onFinance,
  onPrint,
  onVisibleIdsChange,
  pagination,
}: LeaseWorkbenchTableProps) {
  const zh = locale === "zh";
  const [localSort, setLocalSort] = useState<ContractSort>({ key: "unit", direction: "asc" });
  const [requestedPage, setRequestedPage] = useState(1);
  const sort = pagination?.sort ?? localSort;
  const ordered = useMemo(
    () => (pagination ? rows : sortContractRows(rows, sort)),
    [rows, sort, pagination],
  );
  const total = pagination?.total ?? ordered.length;
  const pageSize = pagination?.pageSize ?? PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = pagination?.page ?? Math.min(requestedPage, pages);
  const visible = pagination ? ordered : ordered.slice((page - 1) * pageSize, page * pageSize);
  const visibleIds = JSON.stringify(visible.map((row) => row.id));
  const visibleIdsCallback = useRef(onVisibleIdsChange);

  useEffect(() => {
    visibleIdsCallback.current = onVisibleIdsChange;
  }, [onVisibleIdsChange]);

  useEffect(() => {
    visibleIdsCallback.current?.(JSON.parse(visibleIds) as string[]);
  }, [visibleIds]);

  const columns: { key: ContractSortKey; label: string; numeric?: boolean }[] = [
    { key: "unit", label: zh ? "房源 / 合同" : "Lot / contrat" },
    { key: "customer", label: zh ? "客户" : "Client" },
    { key: "period", label: periodLabel },
    { key: "amount", label: amountLabel, numeric: true },
    { key: "balance", label: zh ? "已建应收未收" : "Créances restantes", numeric: true },
    { key: "status", label: zh ? "状态" : "Statut" },
  ];

  function changeSort(key: ContractSortKey, direction?: "asc" | "desc") {
    const nextDirection =
      direction ?? (sort.key === key && sort.direction === "asc" ? "desc" : "asc");
    if (pagination) {
      pagination.onSortChange(key, nextDirection);
      return;
    }
    onVisibleIdsChange?.([]);
    setLocalSort({ key, direction: nextDirection });
    setRequestedPage(1);
  }

  function changePage(value: number) {
    if (pagination) pagination.onPageChange(value);
    else {
      onVisibleIdsChange?.([]);
      setRequestedPage(value);
    }
  }

  const formatAmount = (amount: number | null) =>
    amount === null ? (zh ? "未核" : "À vérifier") : formatContractXof(amount, locale);

  return (
    <section
      className="lease-workbench-table min-w-0 overflow-hidden rounded-xl border border-border bg-card"
      aria-label={zh ? "合同列表" : "Liste des contrats"}
    >
      <style>{TABLE_STYLES}</style>
      {toolbar ? <div className="border-b border-border p-3">{toolbar}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <p className="text-xs leading-5 text-muted-foreground">
          {zh
            ? "点击房号或客户，在同一档案查看合同并办理"
            : "Lot ou client : un dossier unique pour consulter et agir"}
        </p>
        <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span>{zh ? "排序" : "Trier"}</span>
          <select
            value={`${sort.key}:${sort.direction}`}
            aria-label={zh ? "合同排序" : "Tri des contrats"}
            onChange={(event) => {
              const [key, direction] = event.target.value.split(":") as [
                ContractSortKey,
                "asc" | "desc",
              ];
              changeSort(key, direction);
            }}
            className="h-9 max-w-[190px] rounded-md border border-border bg-card px-2 text-xs text-foreground outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {columns.flatMap((column) =>
              (["asc", "desc"] as const).map((direction) => (
                <option key={`${column.key}:${direction}`} value={`${column.key}:${direction}`}>
                  {column.label} ·{" "}
                  {direction === "asc" ? (zh ? "升序" : "croissant") : zh ? "降序" : "décroissant"}
                </option>
              )),
            )}
          </select>
        </label>
      </div>
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">
          {zh
            ? "合同列表；金额单位为 XOF。点击列标题排序，点击客户查看完整合同。"
            : "Contrats, montants en XOF. Trier avec les en-têtes et ouvrir le contrat via le nom du client."}
        </caption>
        <thead className="border-b border-border bg-muted/35 text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                data-col={column.key}
                className={cn("px-2.5 py-3 font-medium", column.numeric && "text-right")}
                aria-sort={
                  sort.key === column.key
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  onClick={() => changeSort(column.key)}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-sm text-left leading-5 outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                    column.numeric && "text-right",
                    sort.key === column.key && "text-foreground",
                  )}
                >
                  <span>{column.label}</span>
                  {sort.key === column.key ? (
                    sort.direction === "asc" ? (
                      <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
                  )}
                </button>
              </th>
            ))}
            <th scope="col" data-col="actions" className="px-2 py-3 text-right font-medium">
              {zh ? "操作" : "Actions"}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {visible.map((row) => (
            <tr
              key={row.id}
              data-selected={row.id === selectedId ? "true" : undefined}
              className={cn(
                "align-top transition-colors hover:bg-muted/25",
                row.id === selectedId && "bg-blue-50/70 dark:bg-blue-950/25",
              )}
            >
              <td data-col="unit" className="px-2.5 py-3">
                <button
                  type="button"
                  data-contract-link
                  aria-label={`${zh ? "预览合同" : "Aperçu du contrat"} ${row.building} ${row.unit}`}
                  aria-pressed={row.id === selectedId}
                  onClick={() => onSelect(row.id)}
                  className="max-w-full rounded-sm text-left text-sm font-semibold leading-5 text-blue-700 outline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring dark:text-blue-300"
                >
                  {row.unit}
                </button>
                <p className="mt-1 leading-5 text-muted-foreground">{row.building}</p>
                <p className="mt-0.5 break-all text-[11px] leading-4 text-muted-foreground">
                  {row.contractNo || (zh ? "编号待补" : "N° à compléter")}
                </p>
              </td>
              <td data-col="customer" className="px-2.5 py-3">
                <button
                  type="button"
                  data-contract-link
                  onClick={() => onOpen(row.id)}
                  className="max-w-full rounded-sm text-left text-sm font-medium leading-5 outline-offset-4 hover:text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring dark:hover:text-blue-300"
                >
                  {row.customer}
                </button>
                {row.needsReview ? (
                  <p className="mt-1 leading-5 text-amber-700 dark:text-amber-400">
                    {zh ? "资料待核对" : "Dossier à vérifier"}
                  </p>
                ) : null}
                <div data-compact="period" className="mt-1 leading-5 text-muted-foreground">
                  <p>{row.periodLabel}</p>
                  {row.periodDetail ? <p>{row.periodDetail}</p> : null}
                </div>
                <p data-compact="amount" className="mt-1 leading-5 text-muted-foreground">
                  {amountLabel} {row.nativeAmountLabel ?? formatAmount(row.amountXof)}
                  {row.amountDetail ? ` · ${row.amountDetail}` : ""}
                </p>
                <div data-compact="balance" className="mt-1 leading-5">
                  <p className={cn(row.balanceOverdue && "text-red-600 dark:text-red-400")}>
                    {zh ? "已建应收未收" : "Créances restantes"}{" "}
                    {row.nativeBalanceLabel ?? formatAmount(row.balanceXof)}
                  </p>
                  {row.balanceDetail ? (
                    <p className="text-muted-foreground">{row.balanceDetail}</p>
                  ) : null}
                </div>
                <div data-compact="status" className="mt-1 leading-5 text-muted-foreground">
                  {row.statusLabel}
                  {row.secondaryLabel ? ` · ${row.secondaryLabel}` : ""}
                </div>
              </td>
              <td data-col="period" className="px-2.5 py-3 leading-5 tabular-nums">
                <p>{row.periodLabel}</p>
                {row.periodDetail ? (
                  <p className="text-muted-foreground">{row.periodDetail}</p>
                ) : null}
              </td>
              <td data-col="amount" className="px-2.5 py-3 text-right leading-5 tabular-nums">
                <p className="font-medium">
                  {row.nativeAmountLabel ?? formatAmount(row.amountXof)}
                </p>
                {row.amountDetail ? (
                  <p className="mt-1 text-muted-foreground">{row.amountDetail}</p>
                ) : null}
              </td>
              <td data-col="balance" className="px-2.5 py-3 text-right leading-5 tabular-nums">
                <p
                  className={cn(
                    "font-medium",
                    row.balanceOverdue && "text-red-600 dark:text-red-400",
                  )}
                >
                  {row.nativeBalanceLabel ?? formatAmount(row.balanceXof)}
                </p>
                {row.balanceDetail ? (
                  <p className="mt-1 text-muted-foreground">{row.balanceDetail}</p>
                ) : null}
              </td>
              <td data-col="status" className="px-2.5 py-3 leading-5">
                <Badge
                  variant={contractStatusVariant[row.status] ?? "secondary"}
                  className="max-w-full whitespace-normal px-2 py-0.5 text-center font-medium"
                >
                  {row.statusLabel}
                </Badge>
                {row.secondaryLabel ? (
                  <p className="mt-1 text-muted-foreground">{row.secondaryLabel}</p>
                ) : null}
              </td>
              <td data-col="actions" className="px-1.5 py-2.5">
                <div data-row-actions className="flex justify-end gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => onFinance(row.id)}
                    aria-label={`${zh ? "查看财务" : "Voir les finances"} · ${row.unit}`}
                    title={zh ? "查看财务" : "Voir les finances"}
                  >
                    <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => onPrint(row.id)}
                    aria-label={`${zh ? "合同 / 打印" : "Contrat / imprimer"} · ${row.unit}`}
                    title={zh ? "合同 / 打印" : "Contrat / imprimer"}
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {visible.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-14 text-center text-sm text-muted-foreground">
                {zh
                  ? "没有匹配的合同，试试调整筛选或搜索。"
                  : "Aucun contrat. Ajustez les filtres ou la recherche."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-3 text-xs text-muted-foreground">
        <div>
          <p aria-live="polite">
            {total
              ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total}`
              : "0"}{" "}
            {zh ? "份合同" : "contrats"}
          </p>
          <p className="mt-1 text-[11px] leading-4">
            {zh ? "金额 XOF · 月租不是实收" : "Montants XOF · loyer ≠ encaissements"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => changePage(page - 1)}
          >
            {zh ? "上一页" : "Précédent"}
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
            {zh ? "下一页" : "Suivant"}
          </Button>
        </div>
      </div>
    </section>
  );
}
