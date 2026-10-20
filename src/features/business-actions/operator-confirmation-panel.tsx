"use client";
import { useRef, useState } from "react";
import type { buildPaymentPreview } from "./operator-payment-preview";
import { confirmationFeedback } from "./operator-confirmation-feedback";
import { operatorConfirmationFeedbackFr, type OperatorLocale } from "./operator-inbox-panel-labels";
type Preview = Extract<ReturnType<typeof buildPaymentPreview>, { success: true }>["preview"];
export function OperatorConfirmationPanel({
  id,
  preview,
  actor,
  expiresAt,
  completed = false,
  locale = "zh",
}: {
  id: string;
  preview: Preview;
  actor: string;
  expiresAt: string;
  completed?: boolean;
  locale?: OperatorLocale;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const [state, setState] = useState<"ready" | "sending" | "completed" | "failed" | "blocked">(
    completed ? "completed" : "ready",
  );
  const [message, setMessage] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const [checked, setChecked] = useState(false);
  const busy = useRef(false);
  async function confirm() {
    if (
      busy.current ||
      !checked ||
      state === "sending" ||
      state === "completed" ||
      state === "blocked"
    )
      return;
    busy.current = true;
    setState("sending");
    setMessage("");
    try {
      const result = await fetch(`/api/operator/v1/confirmations/${id}`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await result.json();
      if (result.ok && data.status === "completed") {
        setState("completed");
        return;
      }
      const feedback = confirmationFeedback(data.code);
      setMessage(locale === "zh" ? feedback.message : operatorConfirmationFeedbackFr(data.code));
      setLoginRequired(!!feedback.login);
      setState(feedback.retry ? "failed" : "blocked");
      return;
    } catch {
      setMessage(
        text(
          "网络中断，结果未知。请保留此确认单；按原单重试不会创建新的请求号。",
          "Connexion interrompue, résultat inconnu. Conservez cette confirmation ; une nouvelle tentative réutilise le même identifiant.",
        ),
      );
    } finally {
      busy.current = false;
    }
    setState("failed");
  }
  return (
    <section className="mx-auto max-w-2xl space-y-5 rounded-xl border bg-card p-4 sm:p-6">
      <h1 className="text-xl font-semibold">
        {text("核对截图收款", "Vérifier l’encaissement sur justificatif")}
      </h1>
      <p className="text-sm text-muted-foreground">
        {text(
          "这是一次收款确认，不是日常审计复核。请核对后再入账。",
          "Il s’agit de confirmer un encaissement, pas d’un contrôle d’audit périodique. Vérifiez les faits avant d’enregistrer.",
        )}
      </p>
      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        {[
          [text("实际录入账号", "Compte opérateur réel"), actor],
          [text("房间", "Lot"), preview.unitCode || preview.unitNo],
          [
            text("本次收款", "Montant encaissé"),
            `${preview.amountXof.toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR")} XOF`,
          ],
          [text("收款日期", "Date d’encaissement"), preview.paymentDate],
          [text("收据号", "N° de reçu"), preview.receiptNo || text("未填写", "Non renseigné")],
          [
            text("入账后未收", "Solde après encaissement"),
            `${preview.outstandingAfterXof.toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR")} XOF`,
          ],
          [
            text("有效期至（阿比让）", "Valide jusqu’au (Abidjan)"),
            new Date(expiresAt).toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR", {
              timeZone: "Africa/Abidjan",
            }),
          ],
          [text("请求编号", "Identifiant de l’opération"), preview.requestId],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm">
        {preview.originalInstruction}
      </div>
      {state === "completed" ? (
        <p role="status" className="font-medium">
          {completed
            ? text(
                "此确认单此前已执行，本页未重新复查当前账务。不要重复新建付款。",
                "Cette confirmation a déjà été exécutée. Les finances actuelles n’ont pas été revérifiées ici. Ne créez pas un nouveau paiement.",
              )
            : text(
                "已入账并通过结果复查。不要重复新建付款。",
                "Encaissement enregistré et résultat vérifié. Ne créez pas un nouveau paiement.",
              )}
        </p>
      ) : (
        <>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked}
              disabled={state === "sending" || state === "blocked"}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {text(
              "我已核对房间、金额、日期和收据，确认这笔收款。",
              "J’ai vérifié le lot, le montant, la date et le reçu, et je confirme cet encaissement.",
            )}
          </label>
          <button
            type="button"
            onClick={confirm}
            disabled={!checked || state === "sending" || state === "blocked"}
            className="min-h-11 rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-40"
          >
            {state === "sending"
              ? text("正在入账，请勿关闭…", "Enregistrement en cours, ne fermez pas…")
              : state === "failed"
                ? text("按原确认单重试", "Réessayer la même confirmation")
                : state === "blocked"
                  ? text("已停止入账", "Enregistrement arrêté")
                  : text("确认并入账", "Confirmer et enregistrer")}
          </button>
        </>
      )}
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      {loginRequired && (
        <a
          className="inline-block text-sm underline"
          href={`/login?redirect=${encodeURIComponent(`${locale === "fr" ? "/fr" : ""}/operator/confirmations/${id}`)}`}
        >
          {text("重新登录并返回此单", "Se reconnecter et revenir à cette confirmation")}
        </a>
      )}
    </section>
  );
}
