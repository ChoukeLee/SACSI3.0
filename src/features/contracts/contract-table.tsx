"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  DollarSign,
  FileText,
  LayoutGrid,
  List,
  Search,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { contractStatusVariant } from "@/lib/status-styles";
import type { ContractStatus } from "@/types/domain";
import {
  sortContractRows,
  formatContractXof,
  type ContractSort,
  type ContractSortKey,
  type ContractTableRow,
} from "./contract-list-model";

export function ContractListControls({
  locale,
  query,
  onQueryChange,
  view,
  onViewChange,
}: {
  locale: Locale;
  query: string;
  onQueryChange: (value: string) => void;
  view: "table" | "rooms";
  onViewChange: (value: "table" | "rooms") => void;
}) {
  const zh = locale === "zh";
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <label className="relative w-full sm:max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={zh ? "搜索合同、客户或房号" : "Rechercher un contrat, client ou lot"}
          placeholder={zh ? "搜索客户、房号、合同编号…" : "Client, lot, n° de contrat…"}
          className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        />
      </label>
      <div
        className="inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-card p-1"
        role="group"
        aria-label={zh ? "合同视图" : "Présentation des contrats"}
      >
        <button
          type="button"
          aria-pressed={view === "table"}
          onClick={() => onViewChange("table")}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
            view === "table"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <List className="h-3.5 w-3.5" aria-hidden="true" />
          {zh ? "合同列表" : "Liste"}
        </button>
        <button
          type="button"
          aria-pressed={view === "rooms"}
          onClick={() => onViewChange("rooms")}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
            view === "rooms"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
          {zh ? "楼层房源" : "Par étage"}
        </button>
      </div>
    </div>
  );
}

const PAGE_SIZE = 25;

export function ContractTable({
  rows,
  locale,
  amountLabel,
  periodLabel,
  onOpen,
  onFinance,
  onPrint,
  pagination,
}: {
  rows: ContractTableRow[];
  locale: Locale;
  amountLabel: string;
  periodLabel: string;
  onOpen: (id: string) => void;
  onFinance: (id: string) => void;
  onPrint: (id: string) => void;
  pagination?: {
    page: number;
    total: number;
    pageSize: number;
    sort: ContractSort;
    onPageChange: (page: number) => void;
    onSortChange: (key: ContractSortKey, direction: "asc" | "desc") => void;
  };
}) {
  const zh = locale === "zh";
  const formatXof = (amount: number) => formatContractXof(amount, locale);
  const [localSort, setSort] = useState<ContractSort>({ key: "unit", direction: "asc" });
  const sort = pagination?.sort ?? localSort;
  const [requestedPage, setRequestedPage] = useState(1);
  const ordered = useMemo(
    () => (pagination ? rows : sortContractRows(rows, sort)),
    [rows, sort, pagination],
  );
  const total = pagination?.total ?? ordered.length;
  const pageSize = pagination?.pageSize ?? PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = pagination?.page ?? Math.min(requestedPage, pages);
  const visible = pagination ? ordered : ordered.slice((page - 1) * pageSize, page * pageSize);
  const changePage = (value: number) =>
    pagination ? pagination.onPageChange(value) : setRequestedPage(value);
  const columns: { key: ContractSortKey; label: string; numeric?: boolean }[] = [
    { key: "unit", label: zh ? "房源 / 合同" : "Lot / contrat" },
    { key: "customer", label: zh ? "客户" : "Client" },
    { key: "period", label: periodLabel },
    { key: "amount", label: amountLabel, numeric: true },
    { key: "balance", label: zh ? "已建应收未收" : "Créances restantes", numeric: true },
    { key: "status", label: zh ? "状态" : "Statut" },
  ];
  function changeSort(key: ContractSortKey) {
    if (pagination) {
      pagination.onSortChange(key, sort.key === key && sort.direction === "asc" ? "desc" : "asc");
      return;
    }
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
    setRequestedPage(1);
  }
  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label={zh ? "合同列表" : "Liste des contrats"}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <caption className="sr-only">
            {zh
              ? "合同列表；金额单位为 XOF。点击列标题排序，点击客户查看完整合同。"
              : "Contrats, montants en XOF. Trier avec les en-têtes et ouvrir le contrat via le nom du client."}
          </caption>
          <thead className="border-b border-border bg-muted/35 text-xs text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn("px-4 py-3 font-medium", column.numeric && "text-right")}
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
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-sm outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                      sort.key === column.key && "text-foreground",
                    )}
                    onClick={() => changeSort(column.key)}
                  >
                    {column.label}
                    {sort.key === column.key ? (
                      sort.direction === "asc" ? (
                        <ArrowUp className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="h-3 w-3" aria-hidden="true" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                    )}
                  </button>
                </th>
              ))}
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {zh ? "操作" : "Actions"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((row) => (
              <tr key={row.id} className="align-top transition-colors hover:bg-muted/25">
                <td className="max-w-[220px] px-4 py-4">
                  <p className="font-medium">
                    {row.building} · {row.unit}
                  </p>
                  <p className="mt-1 break-all text-xs leading-5 text-muted-foreground">
                    {row.contractNo || (zh ? "编号待补" : "N° à compléter")}
                  </p>
                </td>
                <td className="max-w-[240px] px-4 py-4">
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    className="break-words text-left font-medium leading-6 text-foreground underline-offset-4 hover:text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring dark:hover:text-blue-300"
                  >
                    {row.customer}
                  </button>
                  {row.needsReview && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      {zh ? "资料待核对" : "Dossier à vérifier"}
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-xs leading-6 tabular-nums">
                  <p>{row.periodLabel}</p>
                  {row.periodDetail && <p className="text-muted-foreground">{row.periodDetail}</p>}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                  <p className="font-medium">
                    {row.amountXof === null
                      ? zh
                        ? "待核对"
                        : "À vérifier"
                      : formatXof(row.amountXof)}
                  </p>
                  {row.amountDetail && (
                    <p className="mt-1 text-xs text-muted-foreground">{row.amountDetail}</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                  <p
                    className={cn(
                      "font-medium",
                      row.balanceOverdue && "text-red-600 dark:text-red-400",
                    )}
                  >
                    {row.balanceXof === null ? "—" : formatXof(row.balanceXof)}
                  </p>
                  {row.balanceDetail && (
                    <p className="mt-1 text-xs text-muted-foreground">{row.balanceDetail}</p>
                  )}
                </td>
                <td className="px-4 py-4">
                  <Badge
                    variant={contractStatusVariant[row.status as ContractStatus] ?? "secondary"}
                    className="whitespace-nowrap"
                  >
                    {row.statusLabel}
                  </Badge>
                  {row.secondaryLabel && (
                    <p className="mt-2 text-xs text-muted-foreground">{row.secondaryLabel}</p>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onFinance(row.id)}
                      aria-label={`${zh ? "查看财务" : "Voir les finances"} · ${row.unit}`}
                      title={zh ? "查看财务" : "Voir les finances"}
                    >
                      <DollarSign className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onPrint(row.id)}
                      aria-label={`${zh ? "合同 / 打印" : "Contrat / imprimer"} · ${row.unit}`}
                      title={zh ? "合同 / 打印" : "Contrat / imprimer"}
                    >
                      <FileText className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center text-sm text-muted-foreground">
                  {zh
                    ? "没有匹配的合同，试试调整筛选或搜索。"
                    : "Aucun contrat. Ajustez les filtres ou la recherche."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <p aria-live="polite">
          {total
            ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total}`
            : "0"}{" "}
          {zh ? "份合同" : "contrats"}
        </p>
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
