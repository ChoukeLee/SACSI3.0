"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import { formatPropertyMoney } from "@/lib/property-money";
import { backfillOwnerRentHistory, getOwnerSettlementContext } from "./owner-settlement-actions";
import {
  ownerSettlementError,
  type OwnerSettlementContext,
  type OwnerSettlementPaymentMethod,
} from "./owner-settlement-model";
import {
  parseOwnerRentBackfillInput,
  type OwnerRentAccount,
  type OwnerRentBackfillInput,
  type OwnerRentSummary,
} from "./owner-rent-account-model";
import styles from "./operating-asset-directory.module.css";
import detailStyles from "./operating-asset-detail.module.css";

export function ownerRentMethodLabel(method: OwnerSettlementPaymentMethod | null, locale: Locale) {
  const labels = {
    cash: ["现金", "Espèces"],
    bank_transfer: ["转账", "Virement"],
    check: ["支票", "Chèque"],
    other: ["其他", "Autre"],
  };
  return method === null
    ? locale === "zh"
      ? "未记录"
      : "Non renseigné"
    : labels[method][locale === "zh" ? 0 : 1];
}

export function OwnerRentAccountFacts({
  account,
  summary,
  locale,
}: {
  account: OwnerRentAccount;
  summary?: OwnerRentSummary | null;
  locale: Locale;
}) {
  const zh = locale === "zh";
  const money = (value: number) => formatPropertyMoney(value, "XOF", locale);
  return (
    <>
      <h4>
        {zh ? "业主历史收款及到期未结" : "Encaissements historiques et solde du propriétaire"}
      </h4>
      {summary ? (
        <>
          <dl className={styles.depositFacts}>
            <div>
              <dt>{zh ? "业主累计实收" : "Total effectivement reçu par le propriétaire"}</dt>
              <dd>{money(summary.cumulativeActualNative)}</dd>
            </div>
            <div>
              <dt>{zh ? "业主每月应分账" : "Quote-part mensuelle due"}</dt>
              <dd>{money(summary.monthlyOwnerRentNative)}</dd>
            </div>
            <div>
              <dt>{zh ? "业主分账已结至" : "Quote-part réglée jusqu’au"}</dt>
              <dd>{summary.settledThrough}</dd>
            </div>
            <div>
              <dt>
                {zh
                  ? `业主到期未结（截至 ${summary.asOf}）`
                  : `Solde du propriétaire au ${summary.asOf}`}
              </dt>
              <dd>{money(summary.arrearsNative)}</dd>
            </div>
          </dl>
          <p className={styles.note}>
            {zh
              ? `按完整自然月统计，进入当月即计一期；共 ${summary.dueMonthCount} 期，应分账 ${money(summary.grossDueNative)}，扣结余 ${money(summary.appliedCreditNative)}。历史实收不再重复抵扣。`
              : `${summary.dueMonthCount} mois civils, mois courant inclus ; montant dû ${money(summary.grossDueNative)}, crédit appliqué ${money(summary.appliedCreditNative)}. Les anciens encaissements ne sont pas déduits une seconde fois.`}
          </p>
          <details>
            <summary>
              {zh ? "查看业主逐月未结明细" : "Voir le détail mensuel du propriétaire"}
            </summary>
            <dl className={styles.depositFacts}>
              {summary.periods.map((period) => (
                <div key={period.start}>
                  <dt>
                    {period.start} — {period.end}
                  </dt>
                  <dd>
                    {money(period.outstandingNative)}
                    {period.creditNative > 0
                      ? ` · ${zh ? "已抵结余" : "crédit appliqué"} ${money(period.creditNative)}`
                      : ""}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      ) : (
        <p role="status">
          {zh
            ? "业主账户依据待核，累计实收和未结金额暂不计为零。"
            : "Le compte du propriétaire doit être rapproché ; aucun solde nul n’est présumé."}
        </p>
      )}
      <p className={styles.note}>
        {zh ? "月租依据" : "Source du loyer"}：{account.rateSourceRef}
      </p>
      <p className={styles.note}>
        <strong>{zh ? "核对及更正说明" : "Note de rapprochement et de correction"}：</strong>
        {account.reason}
      </p>
      <ul className={styles.receipts}>
        {account.history.map((row) => (
          <li key={row.entryId}>
            <p>
              {row.cashDate} · {money(row.amountNative)} ·{" "}
              {ownerRentMethodLabel(row.paymentMethod, locale)}
            </p>
            <p className={styles.note}>
              {zh ? "来源" : "Source"}：{row.sourceRef}
            </p>
            <p className={styles.note}>
              <strong>{zh ? "原文" : "Texte original"}：</strong>
              <span style={{ whiteSpace: "pre-wrap" }}>{row.sourceText}</span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

export function OwnerRentHistoryForm({
  assetId,
  today,
  locale,
  disabled,
  onActiveChange,
  onUnresolvedChange,
}: {
  assetId: string;
  today: string;
  locale: Locale;
  disabled: boolean;
  onActiveChange: (active: boolean) => void;
  onUnresolvedChange?: (unresolved: boolean) => void;
}) {
  const zh = locale === "zh";
  const router = useRouter();
  const [context, setContext] = useState<OwnerSettlementContext | null>(null);
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const attempt = useRef<{ requestId: string; input: OwnerRentBackfillInput } | null>(null);
  const inFlight = useRef(false);
  async function open() {
    setBusy(true);
    setError("");
    onActiveChange(true);
    let opened = false;
    try {
      const result = await getOwnerSettlementContext(assetId);
      if (!result.ok) setError(result.error);
      else if (!result.context.previousSettlement) setError("ownerRentAccountAnchorConflict");
      else {
        setContext(result.context);
        opened = true;
      }
    } catch {
      setError("ownerSettlementContextUnavailable");
    } finally {
      setBusy(false);
      if (!opened) onActiveChange(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context?.previousSettlement || inFlight.current) return;
    if (!attempt.current) {
      try {
        const form = new FormData(event.currentTarget);
        const history = Array.from({ length: count }, (_, index) => {
          const rawAmount = String(form.get(`amount-${index}`) ?? "");
          if (!/^[1-9]\d*$/.test(rawAmount)) throw new Error("invalidOwnerRentHistory");
          const method = form.get(`method-${index}`);
          return {
            cashDate: form.get(`date-${index}`),
            amountNative: Number(rawAmount),
            currency: "XOF",
            paymentMethod: method === "not_recorded" ? null : method,
            sourceRef: String(form.get(`source-${index}`) ?? "").trim(),
            sourceText: String(form.get(`text-${index}`) ?? ""),
          };
        });
        const input = parseOwnerRentBackfillInput(
          {
            assetId: context.assetId,
            expectedUpdatedAt: context.expectedUpdatedAt,
            expectedEvidenceHash: context.expectedEvidenceHash,
            expectedSettlementRequestId: context.previousSettlement.requestId,
            rateSourceRef: String(form.get("rateSourceRef") ?? "").trim(),
            reason: String(form.get("historyReason") ?? "").trim(),
            history,
          },
          today,
        );
        if (input.history.some((row) => row.cashDate > context.previousSettlement!.cashDate))
          throw new Error("ownerHistoryOrderConflict");
        attempt.current = { requestId: crypto.randomUUID(), input };
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "invalidOwnerRentHistory");
        return;
      }
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    onUnresolvedChange?.(true);
    try {
      const result = await backfillOwnerRentHistory(
        attempt.current.input,
        attempt.current.requestId,
      );
      if (result.ok) {
        setSaved(true);
        setContext(null);
        attempt.current = null;
        setUnknown(false);
        onActiveChange(false);
        onUnresolvedChange?.(false);
        router.refresh();
      } else {
        setError(result.error);
        setUnknown(!result.rejected);
        if (result.rejected) {
          attempt.current = null;
          onUnresolvedChange?.(false);
        }
      }
    } catch {
      setUnknown(true);
      setError("assetOperationResultUnknown");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div>
      {error ? <p role="alert">{ownerSettlementError(error, zh)}</p> : null}
      {saved ? (
        <p role="status">
          {zh
            ? "历史实收已补录，账户正在刷新。"
            : "Historique enregistré, actualisation du compte."}
        </p>
      ) : null}
      {!context && !saved ? (
        <button
          type="button"
          className={styles.textButton}
          disabled={disabled || busy}
          onClick={open}
        >
          {busy
            ? "…"
            : zh
              ? "补录业主历史收款并建立未结统计"
              : "Compléter l’historique et établir le solde"}
        </button>
      ) : null}
      {context?.previousSettlement ? (
        <form
          className={detailStyles.settlementForm}
          onSubmit={save}
          onChange={() => {
            if (!attempt.current) setError("");
          }}
        >
          <p>
            {context.previousSettlement.ownerName} · {context.previousSettlement.shareBps / 100}% ·{" "}
            {zh ? "分账已结至" : "Quote-part réglée au"} {context.previousSettlement.periodEnd}
          </p>
          <p className={styles.note}>
            {zh
              ? "逐笔按日期递增录入。全部金额填西法元 XOF；原表没有方式时请选择“未记录”。本次只补历史实际收款，不重复登记最近一次收款。"
              : "Saisissez les dates en ordre croissant et les XOF entiers. Choisissez « Non renseigné » si la source ne précise pas le mode. Ne recréez pas le dernier encaissement."}
          </p>
          <fieldset disabled={busy || unknown} className={detailStyles.settlementFields}>
            {Array.from({ length: count }, (_, index) => (
              <fieldset key={index} className={detailStyles.historyRow}>
                <legend>
                  {zh ? `历史收款 ${index + 1}` : `Encaissement historique ${index + 1}`}
                </legend>
                <label>
                  {zh ? "收款日期" : "Date"}
                  <input
                    type="date"
                    name={`date-${index}`}
                    required
                    max={context.previousSettlement!.cashDate}
                  />
                </label>
                <label>
                  {zh ? "实收金额（西法元 XOF）" : "Montant réel (XOF)"}
                  <input
                    type="number"
                    name={`amount-${index}`}
                    required
                    min="1"
                    max="999999999999"
                    step="1"
                  />
                </label>
                <label>
                  {zh ? "收款方式" : "Mode"}
                  <select name={`method-${index}`} required defaultValue="">
                    <option value="" disabled>
                      {zh ? "请选择" : "Sélectionner"}
                    </option>
                    <option value="not_recorded">{zh ? "未记录" : "Non renseigné"}</option>
                    <option value="cash">{zh ? "现金" : "Espèces"}</option>
                    <option value="bank_transfer">{zh ? "转账" : "Virement"}</option>
                    <option value="check">{zh ? "支票" : "Chèque"}</option>
                    <option value="other">{zh ? "其他" : "Autre"}</option>
                  </select>
                </label>
                <label>
                  {zh ? "凭据来源" : "Source"}
                  <input name={`source-${index}`} required maxLength={500} />
                </label>
                <label>
                  {zh ? "原文（保留原表文字）" : "Texte original"}
                  <textarea name={`text-${index}`} required maxLength={2000} />
                </label>
              </fieldset>
            ))}
            <label>
              {zh ? "月租依据" : "Source du loyer mensuel"}
              <input name="rateSourceRef" required maxLength={500} />
            </label>
            <label>
              {zh ? "核对及更正说明" : "Note de rapprochement et de correction"}
              <textarea name="historyReason" required maxLength={2000} />
            </label>
          </fieldset>
          {unknown ? (
            <p className={detailStyles.attention}>
              {zh
                ? "保存结果未确认。表单已锁定，请保留窗口，按原请求重试核对。"
                : "Résultat non confirmé. Conservez cette fenêtre et réessayez la requête verrouillée."}
            </p>
          ) : null}
          <div className={detailStyles.settlementButtons}>
            {!attempt.current ? (
              <>
                <button
                  type="button"
                  disabled={busy || count >= 100}
                  onClick={() => setCount(count + 1)}
                >
                  {zh ? "增加一笔" : "Ajouter"}
                </button>
                <button
                  type="button"
                  disabled={busy || count <= 1}
                  onClick={() => setCount(count - 1)}
                >
                  {zh ? "移除最后一笔" : "Retirer la dernière"}
                </button>
              </>
            ) : null}
            <button type="submit" disabled={busy}>
              {busy
                ? "…"
                : unknown
                  ? zh
                    ? "按原请求重试核对"
                    : "Vérifier la même requête"
                  : zh
                    ? "确认补录历史实收"
                    : "Confirmer l’historique"}
            </button>
            {!attempt.current ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setContext(null);
                  setError("");
                  onActiveChange(false);
                }}
              >
                {zh ? "取消" : "Annuler"}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
