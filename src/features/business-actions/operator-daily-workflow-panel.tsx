"use client";
import { useRef, useState } from "react";
import {
  operatorMethodLabel,
  operatorSourceMessage,
  type OperatorLocale,
} from "./operator-inbox-panel-labels";
export interface DailyWorkflowDisplay {
  unitCode: string;
  guestName: string | null;
  operation: string;
  checkIn: string;
  scheduledCheckOutBefore: string;
  scheduledCheckOutAfter: string;
  actualCheckOutAfter: string | null;
  totalBefore: number;
  totalAfter: number;
  paidBefore: number;
  paidAfter: number;
  outstandingAfter: number;
  amountXof: number;
  paymentDate: string;
  paymentMethod: string;
  cleaningRequired: boolean;
}
export function DailyWorkflowPanel({
  id,
  plan,
  requestId,
  actor,
  originalInstruction,
  expiresAt,
  status,
  locale = "zh",
}: {
  id: string;
  plan: DailyWorkflowDisplay;
  requestId: string;
  actor: string;
  originalInstruction: string;
  expiresAt: string;
  status: string;
  locale?: OperatorLocale;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const [state, setState] = useState(
      ["pending", "completed", "superseded"].includes(status) ? status : "blocked",
    ),
    [checked, setChecked] = useState(false),
    [message, setMessage] = useState(""),
    busy = useRef(false);
  async function confirm() {
    if (busy.current || !checked || !["pending", "unknown"].includes(state)) return;
    busy.current = true;
    setState("sending");
    setMessage("");
    try {
      const r = await fetch(`/api/operator/v1/bookings/confirmations/${id}`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await r.json();
      if (r.ok && data.status === "completed" && data.verified === true) {
        setState("completed");
        setMessage(
          text(
            "整件业务已完成，收款及账务复查通过。",
            "Opération terminée, encaissement et écritures vérifiés.",
          ),
        );
        return;
      }
      setState(r.status >= 500 ? "unknown" : "blocked");
      setMessage(
        data.message
          ? operatorSourceMessage(data.message, locale)
          : text(
              "尚未核实执行结果。请保留原请求号查询，勿换号重录；如需修改或重新准备，请让助手替换旧确认单。",
              "Résultat non confirmé. Conservez l’identifiant, ne recréez pas le paiement. Pour modifier le contenu, demandez le remplacement de la confirmation.",
            ),
      );
    } catch {
      setState("unknown");
      setMessage(
        text(
          "网络中断，结果未知。请按原单重试，不要另建收款。",
          "Connexion interrompue, résultat inconnu. Réessayez la même confirmation sans créer un paiement.",
        ),
      );
    } finally {
      busy.current = false;
    }
  }
  const money = (v: number) => `${v.toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR")} XOF`;
  return (
    <section className="mx-auto max-w-3xl space-y-5 rounded-xl border bg-card p-4 sm:p-6">
      <h1 className="text-xl font-semibold">
        {plan.operation === "extend_and_collect"
          ? text("续住与收款", "Prolongation et encaissement")
          : text("退房与收款", "Départ et encaissement")}{" "}
        · {text("整件业务确认", "Confirmation de l’opération complète")}
      </h1>
      <p>
        {plan.unitCode} · {plan.guestName || text("请核对订单客户", "Vérifier le client du séjour")}{" "}
        · {text("当前账号", "Compte connecté")}：{actor}
      </p>
      <p className="whitespace-pre-wrap break-words rounded-xl border p-4">
        {text("原始要求", "Instruction d’origine")}：{originalInstruction}
      </p>
      <dl className="grid grid-cols-1 gap-3 rounded-xl border p-4 sm:grid-cols-2">
        <div>
          <dt>{text("入住日期", "Date d’arrivée")}</dt>
          <dd>{plan.checkIn}</dd>
        </div>
        <div>
          <dt>{text("计划退房日期", "Départ prévu")}</dt>
          <dd>
            {plan.scheduledCheckOutBefore} → {plan.scheduledCheckOutAfter}
          </dd>
        </div>
        {plan.actualCheckOutAfter && (
          <div>
            <dt>{text("实际退房日期", "Départ réel")}</dt>
            <dd>{plan.actualCheckOutAfter}</dd>
          </div>
        )}
        <div>
          <dt>{text("订单应收", "Montant du séjour")}</dt>
          <dd>
            {money(plan.totalBefore)} → {money(plan.totalAfter)}
          </dd>
        </div>
        <div>
          <dt>{text("订单已收", "Encaissements du séjour")}</dt>
          <dd>
            {money(plan.paidBefore)} → {money(plan.paidAfter)}
          </dd>
        </div>
        <div>
          <dt>{text("变更后未收", "Solde après modification")}</dt>
          <dd>{money(plan.outstandingAfter)}</dd>
        </div>
        <div>
          <dt>{text("本次实收", "Encaissement réel")}</dt>
          <dd>
            {money(plan.amountXof)} · {plan.paymentDate}
          </dd>
        </div>
        <div>
          <dt>{text("收款方式", "Moyen de paiement")}</dt>
          <dd>{operatorMethodLabel(plan.paymentMethod, locale)}</dd>
        </div>
      </dl>
      <p>
        {plan.cleaningRequired
          ? text(
              "本单将办理退房并创建待清洁任务。",
              "Cette opération enregistre le départ et crée une tâche de nettoyage.",
            )
          : text(
              "本单将延长住期，房态保持入住中。",
              "Cette opération prolonge le séjour ; le lot reste occupé.",
            )}
        {text(
          "其他订单和历史欠款不纳入本次收款。任一步失败，整件业务回滚。",
          "Les autres séjours et dettes historiques sont exclus de cet encaissement. Toute erreur annule l’opération entière.",
        )}
      </p>
      <p className="break-all text-xs text-muted-foreground">
        {text("请求号", "Opération")}：{requestId} · {text("有效至", "Valide jusqu’au")}：
        {new Date(expiresAt).toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR", {
          timeZone: "Africa/Abidjan",
        })}
        （{text("阿比让", "Abidjan")}）
      </p>
      {state === "completed" ? (
        <p role="status">
          {message ||
            text(
              "此单此前已完成，本页面未重新复核后续账务，请勿重复创建。",
              "Cette confirmation a déjà été exécutée ; les écritures ultérieures n’ont pas été revérifiées. Ne la recréez pas.",
            )}
        </p>
      ) : state === "superseded" ? (
        <p role="alert">
          {text(
            "此单已被替换，不能执行。",
            "Cette confirmation a été remplacée et ne peut plus être exécutée.",
          )}
        </p>
      ) : (
        <>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={checked}
              disabled={["sending", "blocked"].includes(state)}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {text(
              "我已核对客户、住期、应收变化和实际收款，确认整件业务。",
              "J’ai vérifié le client, le séjour, les montants et l’encaissement réel, et je confirme toute l’opération.",
            )}
          </label>
          <button
            className="min-h-11 rounded-lg bg-primary px-5 py-2 text-primary-foreground disabled:opacity-40"
            onClick={confirm}
            disabled={!checked || !["pending", "unknown"].includes(state)}
          >
            {state === "sending"
              ? text("正在处理…", "Traitement…")
              : state === "unknown"
                ? text("按原单重试", "Réessayer le même document")
                : text("确认整件业务", "Confirmer l’opération complète")}
          </button>
          {message && <p role="alert">{message}</p>}
        </>
      )}
    </section>
  );
}
