"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { formatXof } from "@/lib/utils";
import { decodeReceiptRead } from "./receipt-read-model";
import type { ReceiptReadResult, ReceiptLine } from "./receipt-analysis-types";
import { kindLabel, methodLabel, exclusionLabel } from "./receipt-analysis-format";
import { ReceiptAnalysisDetail } from "./receipt-analysis-detail";
import * as Dialog from "@radix-ui/react-dialog";

interface CalendarCashDetailProps {
  buildingId: string;
  today: string;
  locale: Locale;
  onClose: () => void;
  onPermissionLost?: () => void;
}
export function CalendarCashDetail(props: CalendarCashDetailProps) {
  return <CalendarCashDetailPage key={`${props.buildingId}:${props.today}`} {...props} />;
}

/** Paginated strict cash lines. Full export remains the existing authorized API. */
function CalendarCashDetailPage({
  buildingId,
  today,
  locale,
  onClose,
  onPermissionLost,
}: CalendarCashDetailProps) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ReceiptReadResult>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<ReceiptLine | null>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const query = new URLSearchParams({
    buildingId,
    dateFrom: `${today.slice(0, 7)}-01`,
    dateTo: today,
    page: String(page),
    locale,
  });
  const queryText = query.toString();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setResult(undefined);
    setFailed(false);
    setSelected(null);
    fetch(`/api/daily-rentals/receipts?${queryText}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          if (active && [401, 403].includes(response.status)) onPermissionLost?.();
          throw new Error("CalendarCashDetailsUnavailable");
        }
        const result = decodeReceiptRead(await response.json());
        if (
          result.rows.length !== Math.min(50, Math.max(0, result.total - (page - 1) * 50)) ||
          result.rows.some(
            (row) =>
              row.buildingId !== buildingId ||
              row.date < `${today.slice(0, 7)}-01` ||
              row.date > today,
          )
        )
          throw new Error("CalendarCashDetailsUnavailable");
        return result;
      })
      .then((data) => {
        if (active) setResult(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [queryText, buildingId, page, today, retry, onPermissionLost]);
  query.set("export", "1");
  query.set("page", "1");
  return (
    <>
      <Dialog.Root
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Dialog.Overlay
          className="absolute inset-0 z-overlay !mt-0 bg-black/30 backdrop-blur-sm"
          onClick={onClose}
        />
        <Dialog.Content
          aria-modal="true"
          aria-describedby={undefined}
          aria-label={locale === "zh" ? "本月收款明细" : "Paiements du mois"}
          className="absolute inset-0 z-panel !mt-0 flex flex-col overflow-hidden border-l border-border bg-card shadow-panel"
        >
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <Dialog.Title className="text-sm font-medium">
              {locale === "zh" ? "本月收款明细" : "Paiements du mois"}
            </Dialog.Title>
            <button
              type="button"
              aria-label={locale === "zh" ? "关闭财务明细" : "Fermer le détail financier"}
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-5 space-y-4">
            <p className="text-xs text-muted-foreground">
              {locale === "zh"
                ? "按实际收款日；退款、冲正与未计入记录分别展示。汇总不受当前页影响。"
                : "Date de paiement ; remboursements, contrepassations et exclusions séparés. Synthèse sur toutes les pages."}
            </p>
            {failed ? (
              <p role="alert">
                {locale === "zh"
                  ? "收款明细读取失败，金额未知。"
                  : "Détail indisponible ; montant inconnu."}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  {locale === "zh" ? "重试" : "Réessayer"}
                </button>
              </p>
            ) : !result ? (
              <p role="status">
                {locale === "zh" ? "正在读取完整口径的明细…" : "Chargement des paiements…"}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap justify-between gap-3 rounded-xl bg-muted/50 p-3 text-sm">
                  <span>
                    {locale === "zh" ? "净收款" : "Net"}: {formatXof(result.summary.net)} ·{" "}
                    {result.summary.count} {locale === "zh" ? "笔计入" : "inclus"} ·{" "}
                    {result.summary.excludedCount} {locale === "zh" ? "笔未计入" : "exclus"}
                  </span>
                  <a className="underline" href={`/api/daily-rentals/receipts?${query}`}>
                    {locale === "zh" ? "导出全部记录" : "Exporter toutes les lignes"}
                  </a>
                </div>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-muted/50 text-xs text-muted-foreground">
                        <th className="p-3">{locale === "zh" ? "收款日" : "Date"}</th>
                        <th className="p-3">
                          {locale === "zh" ? "房间 / 经办人" : "Chambre / Responsable"}
                        </th>
                        <th className="p-3">
                          {locale === "zh" ? "性质 / 方式" : "Nature / Moyen"}
                        </th>
                        <th className="p-3 text-right">XOF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-6 text-center text-muted-foreground">
                            {locale === "zh" ? "本月暂无记录" : "Aucune ligne ce mois"}
                          </td>
                        </tr>
                      ) : (
                        result.rows.map((row) => (
                          <tr key={row.id} className="border-t border-border">
                            <td className="p-3 whitespace-nowrap">
                              <button
                                className="underline"
                                type="button"
                                onClick={(event) => {
                                  setSelected(row);
                                  setTrigger(event.currentTarget);
                                }}
                              >
                                {row.date}
                              </button>
                            </td>
                            <td className="p-3">
                              {row.room ?? "—"}
                              <span className="block text-xs text-muted-foreground">
                                {row.bookingAgentName ?? row.guestName ?? "—"}
                              </span>
                            </td>
                            <td className="p-3">
                              {kindLabel(row.kind, locale === "fr")}
                              <span className="block text-xs text-muted-foreground">
                                {row.kind === "excluded"
                                  ? exclusionLabel(row.exclusionReason, locale === "fr")
                                  : methodLabel(row.paymentMethod, locale === "fr")}
                              </span>
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {row.amountXof === null ? "—" : formatXof(row.amountXof)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-end gap-4 text-sm">
                  <span>
                    {result.total} {locale === "zh" ? "笔记录" : "lignes"} · {page}/
                    {Math.max(1, Math.ceil(result.total / 50))}
                  </span>
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    {locale === "zh" ? "上一页" : "Précédent"}
                  </button>
                  <button
                    type="button"
                    disabled={page * 50 >= result.total}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    {locale === "zh" ? "下一页" : "Suivant"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Root>
      <ReceiptAnalysisDetail
        row={selected}
        locale={locale}
        trigger={trigger}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
