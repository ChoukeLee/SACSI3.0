"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileCheck2 } from "lucide-react";
import { RightDrawer } from "@/components/ui/operational";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatXof } from "@/lib/utils";
import {
  decodePaymentContext,
  parsePaymentContextConfirmation,
  type PaymentContext,
} from "./payment-context";

type PeriodForm = { start: string; end: string; source: string };

/** Optional facts only: this component cannot edit amount, currency or payment date. */
export function PaymentContextPanel({
  paymentId,
  locale,
  canWrite,
}: {
  paymentId: string;
  locale: "zh" | "fr";
  canWrite: boolean;
}) {
  const zh = locale === "zh";
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PaymentContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [retry, setRetry] = useState(0);
  const [collector, setCollector] = useState("");
  const [basis, setBasis] = useState("");
  const [periods, setPeriods] = useState<Record<string, PeriodForm>>({});
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const endpoint = `/api/finance/payment-context/${encodeURIComponent(paymentId)}`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError(null);
    setDone(false);
    const load = async () => {
      try {
        const response = await fetch(endpoint, {
          signal: controller.signal,
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("paymentContextUnavailable");
        const result = decodePaymentContext(await response.json());
        setData(result);
        setCollector(result.actualCollector ?? "");
        setBasis(result.collectorBasis ?? "");
        setPeriods(
          Object.fromEntries(
            result.allocations.map((row) => [
              row.receivableId,
              {
                start: row.periodStart ?? "",
                end: row.periodEnd ?? "",
                source: row.periodSource ?? "",
              },
            ]),
          ),
        );
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "paymentContextUnavailable");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [open, endpoint, retry]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !canWrite || busy) return;
    setError(null);
    setDone(false);
    try {
      const editedPeriods = data.allocations.flatMap((row) => {
        const form = periods[row.receivableId];
        if (!form || (!form.start && !form.end && !form.source)) return [];
        return [{ receivableId: row.receivableId, expectedToken: row.token, ...form }];
      });
      const input = {
        expectedToken: data.token,
        ...(collector.trim() || basis.trim()
          ? { collectorName: collector.trim(), collectorBasis: basis.trim() }
          : {}),
        periods: editedPeriods,
      };
      const fingerprint = JSON.stringify(input);
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { fingerprint, requestId: crypto.randomUUID() };
      const payload = parsePaymentContextConfirmation({
        input,
        requestId: attempt.current.requestId,
      });
      setBusy(true);
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.error === "string" ? result.error : "paymentContextUnavailable",
        );
      setData(decodePaymentContext(result));
      setDone(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "paymentContextUnavailable");
    } finally {
      setBusy(false);
    }
  }

  const errorText =
    error === "invalidPaymentContext"
      ? text(
          "请填写完整的实际收款人及依据，或完整账期与来源。不能用到期日代替账期。",
          "Renseignez l'encaisseur et sa preuve, ou une période complète et sa source. L'échéance ne remplace pas la période.",
        )
      : error === "paymentContextSnapshotChanged" ||
          error === "paymentContextTargetMismatch" ||
          error === "paymentContextRequestConflict"
        ? text(
            "记录已变化或关联不匹配，请重新读取后核对。没有修改金额。",
            "La situation a changé ou le lien diffère. Rechargez puis vérifiez ; aucun montant modifié.",
          )
        : text(
            "付款事实暂时无法读取或确认，请重试；不会显示为零或自动补写。",
            "Lecture ou confirmation indisponible. Réessayez ; aucune donnée inventée ni montant remplacé par zéro.",
          );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
        {text("付款事实", "Contexte du paiement")}
      </button>
      <RightDrawer
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={text("付款事实与账期", "Faits et période du paiement")}
        subtitle={text(
          "只补充已核实事实，不修改收款金额、币种或付款日期。",
          "Compléments vérifiés uniquement ; montant, devise et date inchangés.",
        )}
        width="wide"
      >
        {loading && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {text("读取实时记录…", "Lecture en cours…")}
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <p>{errorText}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={busy}
              onClick={() => setRetry((value) => value + 1)}
            >
              {text("重新读取", "Recharger")}
            </Button>
          </div>
        )}
        {data && (
          <form onSubmit={(event) => void submit(event)} className="space-y-5">
            <dl className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {text("原币金额（只读）", "Montant original")}
                </dt>
                <dd className="mt-1 font-semibold tabular-nums">
                  {new Intl.NumberFormat(zh ? "zh-CN" : "fr-FR", {
                    maximumFractionDigits: 2,
                  }).format(data.amount)}{" "}
                  {data.currency}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {text("付款日期（只读）", "Date du paiement")}
                </dt>
                <dd className="mt-1 tabular-nums">{data.paymentDate}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">
                  {text("录入账号，不等于实际收款人", "Compte de saisie, distinct de l'encaisseur")}
                </dt>
                <dd className="mt-1" title={data.recordedBy ?? undefined}>
                  {data.recordedByName ??
                    (data.recordedBy
                      ? text("已记录账号身份", "Identité du compte enregistrée")
                      : text("历史未记录，不推断", "Historique non renseigné"))}
                </dd>
              </div>
            </dl>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{text("实际收款人", "Encaisseur réel")}</h3>
              <p className="text-xs leading-5 text-muted-foreground">
                {text(
                  "客户、业务经办人、录入账号与实际收款人是不同角色。没有明确凭证时留空，不能默认是你。",
                  "Client, responsable, compte de saisie et encaisseur sont des rôles distincts. Sans preuve explicite, laissez vide.",
                )}
              </p>
              <label className="block space-y-1 text-xs">
                <span>{text("明确姓名", "Nom confirmé")}</span>
                <Input
                  value={collector}
                  maxLength={100}
                  disabled={!canWrite || busy || done}
                  onChange={(event) => setCollector(event.target.value)}
                  placeholder={text("未知请留空", "Laisser vide si inconnu")}
                />
              </label>
              <label className="block space-y-1 text-xs">
                <span>
                  {text("确认依据（收据编号、凭证说明或人工确认）", "Source de confirmation")}
                </span>
                <Input
                  value={basis}
                  maxLength={1000}
                  disabled={!canWrite || busy || done}
                  onChange={(event) => setBasis(event.target.value)}
                />
              </label>
            </section>
            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold">
                {text("已明确分配的应收与服务账期", "Créances réparties et périodes de service")}
              </h3>
              <p className="text-xs leading-5 text-muted-foreground">
                {text(
                  "只展示已明确关联的应收，不猜历史分账。到期日是催收节点，不是账期。两端日期按凭证原文填写。",
                  "Uniquement les liens explicites, sans reconstituer l'historique. L'échéance n'est pas la période ; recopiez les deux dates du justificatif.",
                )}
              </p>
              {!data.allocations.length && (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  {text(
                    "这笔付款尚无明确分配关系；历史归属需另行核对，不在此自动补账。",
                    "Aucune répartition explicite ; l'attribution historique nécessite une vérification séparée.",
                  )}
                </p>
              )}
              {data.allocations.map((row) => (
                <fieldset
                  key={row.receivableId}
                  disabled={!canWrite || busy || done}
                  className="space-y-3 rounded-lg border p-3"
                >
                  <legend className="px-1 text-sm font-medium">{row.title}</legend>
                  <p className="text-xs text-muted-foreground">
                    {formatXof(row.allocatedXof)} · {text("到期日", "Échéance")} {row.dueDate}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {(["start", "end"] as const).map((key) => (
                      <label key={key} className="block space-y-1 text-xs">
                        <span>
                          {key === "start"
                            ? text("账期开始", "Début de période")
                            : text("账期结束", "Fin de période")}
                        </span>
                        <Input
                          type="date"
                          value={periods[row.receivableId]?.[key] ?? ""}
                          onChange={(event) =>
                            setPeriods((current) => ({
                              ...current,
                              [row.receivableId]: {
                                ...current[row.receivableId],
                                [key]: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label className="block space-y-1 text-xs">
                    <span>{text("账期来源 / 凭证依据", "Source / justificatif de période")}</span>
                    <Input
                      value={periods[row.receivableId]?.source ?? ""}
                      maxLength={1000}
                      onChange={(event) =>
                        setPeriods((current) => ({
                          ...current,
                          [row.receivableId]: {
                            ...current[row.receivableId],
                            source: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                </fieldset>
              ))}
            </section>
            {done && (
              <p
                role="status"
                className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
              >
                {text(
                  "事实已确认并留痕，金额与余额未修改。",
                  "Faits confirmés et audités ; montants et soldes inchangés.",
                )}
              </p>
            )}
            {canWrite && (
              <Button type="submit" disabled={busy || done} className="w-full">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {text(
                  "确认事实并记录审计（不改金额）",
                  "Confirmer et auditer — sans changer les montants",
                )}
              </Button>
            )}
          </form>
        )}
      </RightDrawer>
    </>
  );
}
