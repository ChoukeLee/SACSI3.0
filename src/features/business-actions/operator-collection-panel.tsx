"use client";
import { useRef, useState } from "react";
import type { collectionPreview } from "./operator-batch";
import { collectionFeedback } from "./operator-batch";
import {
  operatorMethodLabel,
  operatorSourceMessage,
  type OperatorLocale,
} from "./operator-inbox-panel-labels";
export function OperatorCollectionPanel({
  id,
  rows,
  totalXof,
  actor,
  requestId,
  expiresAt,
  status,
  locale = "zh",
}: {
  id: string;
  rows: ReturnType<typeof collectionPreview>;
  totalXof: number;
  actor: string;
  requestId: string;
  expiresAt: string;
  status: string;
  locale?: OperatorLocale;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const [state, setState] = useState(
      ["pending", "completed", "superseded"].includes(status) ? status : "blocked",
    ),
    busy = useRef(false);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const amount = (n: number) => `${n.toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR")} XOF`;
  async function confirm() {
    if (busy.current || !checked || !["pending", "unknown"].includes(state)) return;
    busy.current = true;
    setState("sending");
    setMessage("");
    try {
      const response = await fetch(`/api/operator/v1/collections/${id}`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await response.json();
      if (response.ok && data.status === "completed" && data.verified) {
        setState("completed");
        setMessage(
          text(
            "整批已入账，分项金额及审计复查通过。",
            "Le lot a été enregistré ; les montants détaillés et l’audit ont été vérifiés.",
          ),
        );
        return;
      }
      const unknown = response.status >= 500;
      setState(unknown ? "unknown" : "blocked");
      setMessage(
        unknown
          ? text(
              "结果暂时无法确认。请保留本单并按原单重试，不要重新创建收款。",
              "Résultat inconnu. Conservez ce document et réessayez la même confirmation, sans créer un nouvel encaissement.",
            )
          : operatorSourceMessage(collectionFeedback(data.code), locale),
      );
    } catch {
      setState("unknown");
      setMessage(
        text(
          "网络中断，结果未知。恢复后按原单重试，不要换请求号。",
          "Connexion interrompue, résultat inconnu. Réessayez le même document sans changer d’identifiant.",
        ),
      );
    } finally {
      busy.current = false;
    }
  }
  return (
    <section className="mx-auto w-full max-w-4xl space-y-5 rounded-xl border bg-card p-4 sm:p-6">
      <h1 className="text-xl font-semibold">
        {text("核对整批收款与分账", "Vérifier les encaissements et leur répartition")}
      </h1>
      <p>
        {text(
          `共 ${rows.length} 行 · 合计 ${amount(totalXof)} · 登录账号：${actor}`,
          `${rows.length} ligne(s) · Total ${amount(totalXof)} · Compte connecté : ${actor}`,
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        {text(
          "整批核对后一次入账。任何一项发生冲突，整批停止。请特别核对客户、账期、收款方式和租金已缴至日期。",
          "Vérifiez tout le lot avant l’enregistrement. Tout conflit bloque le lot entier. Vérifiez notamment le client, les périodes, le moyen de paiement et la couverture du loyer.",
        )}
      </p>
      {rows.map((row) => (
        <article key={row.lineId} className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">
            {row.unitLabel} · {row.customer} ·{" "}
            {row.contractNo || text("日租订单", "Séjour journalier")}
          </h2>
          <p className="whitespace-pre-wrap break-words text-sm">
            {text(`凭证第 ${row.lineId} 行：`, `Ligne ${row.lineId} du justificatif : `)}
            {row.sourceText}
          </p>
          <p className="text-sm">
            {text("收款", "Encaissement")} {amount(row.totalXof)} · {row.paymentDate} ·{" "}
            {operatorMethodLabel(row.paymentMethod, locale)} · {text("收据", "Reçu")}{" "}
            {row.receiptNo || text("未提供", "Non fourni")}
          </p>
          {row.paidThroughDate && (
            <p className="text-sm font-medium">
              {text("租金已缴至将更新为：", "La couverture du loyer sera mise à jour au : ")}
              {row.paidThroughDate}
              {text("（请核对完整覆盖期间）", " (vérifier la période complète couverte)")}
            </p>
          )}
          <ul className="space-y-2">
            {row.allocations.map((a) => (
              <li key={a.receivableId} className="rounded-lg bg-muted p-3 text-sm">
                <p>
                  {a.category} · {a.title} · {text("应收日期", "Échéance")} {a.dueDate}
                </p>
                <p>
                  {text("本次", "Affecté")} {amount(a.amountXof)} · {text("未收", "Solde")}{" "}
                  {amount(a.outstandingBeforeXof)} → {amount(a.outstandingAfterXof)}
                </p>
              </li>
            ))}
          </ul>
        </article>
      ))}
      <p className="break-all text-xs text-muted-foreground">
        {text("请求号", "Opération")}：{requestId} ·{" "}
        {text("有效至（阿比让）", "Valide jusqu’au (Abidjan)")}：
        {new Date(expiresAt).toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR", {
          timeZone: "Africa/Abidjan",
        })}
      </p>
      {state === "completed" ? (
        <p role="status">
          {message ||
            text(
              "此批次此前已完成，未在本页重新核查当前账务。请勿再次新建收款。",
              "Ce lot a déjà été exécuté ; les finances actuelles n’ont pas été revérifiées ici. Ne créez pas un nouveau paiement.",
            )}
        </p>
      ) : state === "superseded" ? (
        <p role="alert">
          {text(
            "此单已被重新准备的确认单替代，不能再执行。",
            "Cette confirmation a été remplacée et ne peut plus être exécutée.",
          )}
        </p>
      ) : (
        <>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={checked}
              disabled={["sending", "blocked"].includes(state)}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {text(
              "我已逐行核对原始凭证、合同、应收分配和合计，确认整批收款。",
              "J’ai vérifié chaque justificatif, contrat, affectation et total, et je confirme l’ensemble du lot.",
            )}
          </label>
          <button
            className="min-h-11 rounded-lg bg-primary px-5 py-2 text-primary-foreground disabled:opacity-40"
            onClick={confirm}
            disabled={!checked || !["pending", "unknown"].includes(state)}
          >
            {state === "sending"
              ? text("正在入账…", "Enregistrement…")
              : state === "unknown"
                ? text("按原确认单重试", "Réessayer la même confirmation")
                : text("确认整批入账", "Confirmer l’enregistrement du lot")}
          </button>
          {message && <p role="alert">{message}</p>}
        </>
      )}
    </section>
  );
}
