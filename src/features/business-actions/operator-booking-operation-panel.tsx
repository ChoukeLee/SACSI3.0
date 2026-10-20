"use client";
import { useRef, useState } from "react";
import { operatorSourceMessage, type OperatorLocale } from "./operator-inbox-panel-labels";
import { bookingOperationLabel, isHighRiskBookingOperation } from "./booking-operation-contract";
const fields: Record<string, string> = {
  unitCode: "原房间",
  targetUnitCode: "目标房间",
  bookingAgent: "业务经办人",
  guestName: "入住客人",
  checkInBefore: "原入住日期",
  checkInAfter: "新入住日期",
  checkOutBefore: "原退房日期",
  checkOutAfter: "新退房日期",
  priceBefore: "原日价（XOF）",
  priceAfter: "新日价（XOF）",
  totalBefore: "原应收（XOF）",
  totalAfter: "新应收（XOF）",
  paidBefore: "原净收款（XOF）",
  paidAfter: "新净收款（XOF）",
  amountXof: "本次退款或冲正金额（XOF）",
  paymentDate: "实际退款日期",
  paymentMethod: "实际退款方式",
  paymentCount: "关联收款条数",
  receivableCount: "关联应收条数",
  ledgerCount: "关联账本条数",
  reason: "变更原因",
};
const fieldsFr: Record<string, string> = {
  unitCode: "Lot d’origine",
  targetUnitCode: "Lot cible",
  bookingAgent: "Responsable du dossier",
  guestName: "Occupant",
  checkInBefore: "Ancienne arrivée",
  checkInAfter: "Nouvelle arrivée",
  checkOutBefore: "Ancien départ",
  checkOutAfter: "Nouveau départ",
  priceBefore: "Ancien tarif journalier (XOF)",
  priceAfter: "Nouveau tarif journalier (XOF)",
  totalBefore: "Ancien montant dû (XOF)",
  totalAfter: "Nouveau montant dû (XOF)",
  paidBefore: "Ancien encaissement net (XOF)",
  paidAfter: "Nouvel encaissement net (XOF)",
  amountXof: "Remboursement ou extourne (XOF)",
  paymentDate: "Date réelle de remboursement",
  paymentMethod: "Moyen réel de remboursement",
  paymentCount: "Paiements liés",
  receivableCount: "Créances liées",
  ledgerCount: "Écritures liées",
  reason: "Motif de modification",
};
const operationsFr: Record<string, string> = {
  create: "Créer une réservation",
  check_in: "Enregistrer une arrivée (sans paiement)",
  cancel: "Annuler une réservation non arrivée",
  change_stay: "Modifier les dates ou le tarif",
  correct_room: "Corriger le lot saisi par erreur",
  transfer: "Transférer une réservation non arrivée",
  reverse: "Extourner un paiement erroné",
  refund: "Enregistrer un remboursement réel",
  void_checkin: "Annuler une arrivée erronée",
};
export function BookingOperationPanel({
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
  plan: Record<string, unknown>;
  requestId: string;
  actor: string;
  originalInstruction: string;
  expiresAt: string;
  status: string;
  locale?: OperatorLocale;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const busy = useRef(false);
  const [state, setState] = useState(
      ["pending", "completed", "superseded"].includes(status) ? status : "blocked",
    ),
    [checked, setChecked] = useState(false),
    [highRiskChecked, setHighRiskChecked] = useState(false),
    [message, setMessage] = useState("");
  const highRisk = isHighRiskBookingOperation(plan.operation);
  async function confirm() {
    if (
      busy.current ||
      !checked ||
      (highRisk && !highRiskChecked) ||
      !["pending", "unknown"].includes(state)
    )
      return;
    busy.current = true;
    setState("sending");
    try {
      const r = await fetch(`/api/operator/v1/booking-operations/confirmations/${id}`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await r.json();
      if (r.ok && data.status === "completed" && data.verified === true) {
        setState("completed");
        setMessage(
          text("业务已完成并通过本次执行核验。", "Opération terminée et exécution vérifiée."),
        );
        return;
      }
      if (r.ok && data.status === "completed_previously") {
        setState("completed");
        setMessage(
          text(
            "原单此前已完成，没有重复执行；未重新复核后续全部账务。",
            "Cette confirmation a déjà été exécutée, sans nouvelle exécution ; les écritures ultérieures n’ont pas toutes été revérifiées.",
          ),
        );
        return;
      }
      setState(r.status >= 500 ? "unknown" : "blocked");
      setMessage(
        data.message
          ? operatorSourceMessage(data.message, locale)
          : text(
              "结果未核实，请保留原请求号查询或联系 Chucke。",
              "Résultat non confirmé. Conservez l’identifiant pour vérification ou contactez Chucke.",
            ),
      );
    } catch {
      setState("unknown");
      setMessage(
        text(
          "网络中断，结果未知。请按原单重试，勿换号重录。",
          "Connexion interrompue, résultat inconnu. Réessayez le même document sans changer d’identifiant.",
        ),
      );
    } finally {
      busy.current = false;
    }
  }
  return (
    <section className="mx-auto max-w-3xl space-y-4 rounded-xl border bg-card p-4 sm:p-6">
      <h1 className="text-xl font-semibold">
        {locale === "zh"
          ? bookingOperationLabel(plan.operation)
          : operationsFr[String(plan.operation)] || "Opération à vérifier"}{" "}
        · {text("本人确认", "Confirmation personnelle")}
      </h1>
      <p>
        {text("实际操作账号", "Compte opérateur réel")}：{actor}
      </p>
      <p className="whitespace-pre-wrap break-words rounded-lg border p-3">{originalInstruction}</p>
      <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
        {Object.entries(fields)
          .filter(([key]) => plan[key] !== null && plan[key] !== undefined)
          .map(([key, label]) => (
            <div key={key}>
              <dt className="text-sm text-muted-foreground">
                {locale === "zh" ? label : fieldsFr[key]}
              </dt>
              <dd className="break-words">{String(plan[key])}</dd>
            </div>
          ))}
      </dl>
      <p>{plan.notice ? operatorSourceMessage(String(plan.notice), locale) : ""}</p>
      <p className="break-all text-xs">
        {text("请求号", "Opération")}：{requestId} · {text("有效至", "Valide jusqu’au")} {expiresAt}
        （UTC）
      </p>
      {state === "completed" ? (
        <p role="status">
          {message ||
            text(
              "此单此前已完成，请勿重复执行。",
              "Cette confirmation a déjà été exécutée. Ne l’exécutez pas à nouveau.",
            )}
        </p>
      ) : state === "superseded" ? (
        <p role="alert">{text("此单已被替换。", "Cette confirmation a été remplacée.")}</p>
      ) : (
        <>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {text(
              "我已核对房间、客人、经办人、日期与金额。",
              "J’ai vérifié le lot, l’occupant, le responsable, les dates et les montants.",
            )}
          </label>
          {highRisk && (
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={highRiskChecked}
                onChange={(e) => setHighRiskChecked(e.target.checked)}
              />
              {plan.operation === "refund"
                ? text(
                    "我确认款项已经实际退给客户，日期、方式和金额正确。",
                    "Je confirme le remboursement réel au client, avec la bonne date, le bon moyen et le bon montant.",
                  )
                : text(
                    "我确认变更原因及影响；冲正不是实际退钱。不确定时先联系 Chucke。",
                    "Je confirme le motif et les effets. Une extourne n’est pas un remboursement réel. En cas de doute, contactez d’abord Chucke.",
                  )}
            </label>
          )}
          <button
            className="rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-40"
            onClick={confirm}
            disabled={
              !checked || (highRisk && !highRiskChecked) || !["pending", "unknown"].includes(state)
            }
          >
            {state === "sending"
              ? text("正在处理…", "Traitement…")
              : state === "unknown"
                ? text("按原单重试", "Réessayer le même document")
                : text("确认执行业务", "Confirmer l’exécution")}
          </button>
          {message && <p role="alert">{message}</p>}
        </>
      )}
    </section>
  );
}
