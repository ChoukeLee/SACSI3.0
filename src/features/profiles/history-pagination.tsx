"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/** Display pagination only: callers supply the complete, authorized history. */
export function useHistoryPage<T>(rows: T[], pageSize = 25) {
  const [requestedPage, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageCount, total: rows.length, pageSize, onChange: setPage },
  };
}

export function HistoryPagination({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
  locale,
  kind = "history",
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  locale: Locale;
  kind?: "history" | "records";
}) {
  if (total === 0) return null;
  const zh = locale === "zh";
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label={
        kind === "history"
          ? zh
            ? "历史记录分页"
            : "Pagination de l’historique"
          : zh
            ? "记录分页"
            : "Pagination des résultats"
      }
      className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground"
    >
      <span>
        {zh
          ? `${kind === "history" ? "完整历史" : "完整结果"} · ${first}–${last} / ${total} 条`
          : `${kind === "history" ? "Historique complet" : "Résultats complets"} · ${first}–${last} / ${total}`}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => onChange(page - 1)}
          >
            {zh ? "上一页" : "Précédent"}
          </Button>
          <span className="tabular-nums">
            {page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === pageCount}
            onClick={() => onChange(page + 1)}
          >
            {zh ? "下一页" : "Suivant"}
          </Button>
        </div>
      )}
    </nav>
  );
}
