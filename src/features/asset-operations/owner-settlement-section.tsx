"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import { formatPropertyMoney } from "@/lib/property-money";
import { getOwnerSettlementContext, recordOwnerSettlement } from "./owner-settlement-actions";
import {
  ownerSettlementError,
  ownerSettlementPreview,
  parseOwnerSettlementInput,
  type OwnerSettlement,
  type OwnerSettlementContext,
  type OwnerSettlementInput,
} from "./owner-settlement-model";
import styles from "./operating-asset-directory.module.css";
import detailStyles from "./operating-asset-detail.module.css";

function wholeValue(data: FormData, name: string) {
  const value = data.get(name);
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))
    throw new Error("invalidOwnerSettlement");
  return Number(value);
}

function formInput(form: HTMLFormElement, context: OwnerSettlementContext, today: string) {
  const data = new FormData(form);
  const share = String(data.get("sharePercent") ?? "");
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(share)) throw new Error("invalidOwnerSettlement");
  const [integer, fraction = ""] = share.split(".");
  return parseOwnerSettlementInput(
    {
      assetId: context.assetId,
      expectedUpdatedAt: context.expectedUpdatedAt,
      expectedEvidenceHash: context.expectedEvidenceHash,
      ownerName: String(data.get("ownerName") ?? "").trim(),
      shareBps: Number(integer) * 100 + Number(fraction.padEnd(2, "0")),
      amountNative: wholeValue(data, "amountNative"),
      currency: "XOF",
      cashDate: data.get("cashDate"),
      paymentMethod: data.get("paymentMethod"),
      periodStart: data.get("periodStart"),
      periodEnd: data.get("periodEnd"),
      openingWholeCredit: wholeValue(data, "openingWholeCredit"),
      closingWholeCredit: wholeValue(data, "closingWholeCredit"),
      sourceRef: String(data.get("sourceRef") ?? "").trim(),
      reason: String(data.get("reason") ?? "").trim(),
    },
    today,
  );
}

function SettlementFacts({
  settlement: s,
  locale,
}: {
  settlement: OwnerSettlement;
  locale: Locale;
}) {
  const zh = locale === "zh";
  const money = (amount: number) => formatPropertyMoney(amount, "XOF", locale);
  return (
    <>
      <dl className={styles.depositFacts}>
        <div>
          <dt>{zh ? "业主 / 股比" : "Propriétaire / quote-part"}</dt>
          <dd>
            {s.ownerName} · {s.shareBps / 100}%
          </dd>
        </div>
        <div>
          <dt>{zh ? "现金实收" : "Encaissement effectif"}</dt>
          <dd>
            {money(s.receiptAmountNative)} · {s.cashDate}
          </dd>
        </div>
        <div>
          <dt>{zh ? "整厂换算等值" : "Équivalent pour le bien entier"}</dt>
          <dd>{money(s.wholeEquivalent)}</dd>
        </div>
        <div>
          <dt>{zh ? "期初整厂结余核销" : "Crédit global d’ouverture utilisé"}</dt>
          <dd>{money(s.wholeOpeningCredit)}</dd>
        </div>
        <div>
          <dt>{zh ? "本次分账结清期" : "Période de quote-part réglée"}</dt>
          <dd>
            {s.periodStart} — {s.periodEnd} · {s.monthCount} {zh ? "个月" : "mois"}
          </dd>
        </div>
        <div>
          <dt>{zh ? "本期整厂租金" : "Loyer global de la période"}</dt>
          <dd>{money(s.wholeRent)}</dd>
        </div>
        <div>
          <dt>{zh ? "期末整厂结余" : "Crédit global de clôture"}</dt>
          <dd>{money(s.wholeClosingCredit)}</dd>
        </div>
      </dl>
      <p className={styles.note}>
        {zh ? "凭据来源" : "Source"}：{s.sourceRef}
      </p>
      <p className={styles.note}>{s.reason}</p>
    </>
  );
}

export function OwnerSettlementSection({
  assetId,
  settlement,
  canWrite,
  today,
  locale,
  onUnresolvedChange,
}: {
  assetId: string;
  settlement?: OwnerSettlement;
  canWrite: boolean;
  today: string;
  locale: Locale;
  onUnresolvedChange?: (unresolved: boolean) => void;
}) {
  const zh = locale === "zh";
  const router = useRouter();
  const id = useId();
  const [context, setContext] = useState<OwnerSettlementContext | null>(null);
  const [saved, setSaved] = useState<OwnerSettlement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ input: OwnerSettlementInput; requestId: string } | null>(
    null,
  );
  const attemptRef = useRef<typeof pending>(null);
  const inFlight = useRef(false);
  const [unknown, setUnknown] = useState(false);
  const [preview, setPreview] = useState<
    (ReturnType<typeof ownerSettlementPreview> & { input: OwnerSettlementInput }) | null
  >(null);
  const displayed = saved ?? (context ? context.previousSettlement : settlement);
  const money = (amount: number) => formatPropertyMoney(amount, "XOF", locale);

  async function open() {
    setBusy(true);
    setError("");
    try {
      const result = await getOwnerSettlementContext(assetId);
      if (result.ok) setContext(result.context);
      else setError(result.error);
    } catch {
      setError("ownerSettlementContextUnavailable");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || inFlight.current) return;
    let attempt = attemptRef.current;
    if (!attempt) {
      try {
        const input = formInput(event.currentTarget, context, today);
        const calculation = ownerSettlementPreview(input, context.monthlyRentNative);
        setPreview({ ...calculation, input });
        if (!calculation.balanced) throw new Error("ownerSettlementEquationMismatch");
        attempt = { input, requestId: crypto.randomUUID() };
        attemptRef.current = attempt;
        setPending(attempt);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "invalidOwnerSettlement");
        return;
      }
    }
    setBusy(true);
    inFlight.current = true;
    setError("");
    onUnresolvedChange?.(true);
    try {
      const result = await recordOwnerSettlement(attempt.input, attempt.requestId);
      if (result.ok) {
        setSaved(result.settlement);
        setContext(null);
        setPending(null);
        attemptRef.current = null;
        setUnknown(false);
        setPreview(null);
        onUnresolvedChange?.(false);
        router.refresh();
      } else {
        setError(result.error);
        setUnknown(!result.rejected);
        if (result.rejected) {
          setPending(null);
          attemptRef.current = null;
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
    <section className={styles.detailSection} aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>
        {zh ? "业主分账结算" : "Règlement de la quote-part du propriétaire"}
      </h3>
      {displayed ? (
        <SettlementFacts settlement={displayed} locale={locale} />
      ) : (
        <p className={styles.note}>
          {zh ? "暂无业主分账结算记录。" : "Aucun règlement enregistré."}
        </p>
      )}
      <p className={styles.note}>
        {zh
          ? "本节登记业主实收及结余核销；租客付款进度和其他期间待核款项分别保留。"
          : "Cette section documente l’encaissement du propriétaire et l’utilisation du crédit. Le suivi des paiements du locataire et les autres soldes à vérifier sont conservés séparément."}
      </p>
      {saved ? <p role="status">{zh ? "业主分账结算已登记。" : "Règlement enregistré."}</p> : null}
      {error ? <p role="alert">{ownerSettlementError(error, zh)}</p> : null}
      {canWrite && !context ? (
        <button type="button" className={styles.textButton} disabled={busy} onClick={open}>
          {busy
            ? zh
              ? "读取中…"
              : "Chargement…"
            : zh
              ? "登记业主分账结算"
              : "Enregistrer un règlement"}
        </button>
      ) : null}
      {canWrite && context ? (
        <form
          className={detailStyles.settlementForm}
          onSubmit={save}
          onChange={(event) => {
            if (pending) return;
            setError("");
            try {
              const input = formInput(event.currentTarget, context, today);
              setPreview({ ...ownerSettlementPreview(input, context.monthlyRentNative), input });
            } catch {
              setPreview(null);
            }
          }}
        >
          <p>
            {context.assetName} · {zh ? "整厂月租" : "Loyer mensuel global"}{" "}
            {money(context.monthlyRentNative)}
          </p>
          <p className={styles.note}>
            {zh
              ? "金额全部以西法元（XOF）填写，例如 500 万填 5000000；结余没有金额也请明确填 0。"
              : "Saisissez des XOF entiers : 5 millions = 5000000. Indiquez explicitement 0 pour un crédit nul."}
          </p>
          <fieldset disabled={busy || unknown} className={detailStyles.settlementFields}>
            <label>
              <span>{zh ? "业主姓名" : "Nom du propriétaire"}</span>
              <input name="ownerName" required maxLength={200} />
            </label>
            <label>
              <span>{zh ? "股比（%）" : "Quote-part (%)"}</span>
              <input name="sharePercent" type="number" required min="0.01" max="100" step="0.01" />
            </label>
            <label>
              <span>{zh ? "实收金额（西法元 XOF）" : "Montant encaissé (XOF)"}</span>
              <input
                name="amountNative"
                type="number"
                required
                min="1"
                max="999999999999"
                step="1"
              />
            </label>
            <label>
              <span>{zh ? "收款日期" : "Date d’encaissement"}</span>
              <input name="cashDate" type="date" required max={today} />
            </label>
            <label>
              <span>{zh ? "收款方式" : "Mode de paiement"}</span>
              <select name="paymentMethod" required defaultValue="">
                <option value="" disabled>
                  {zh ? "请选择" : "Sélectionner"}
                </option>
                <option value="cash">{zh ? "现金" : "Espèces"}</option>
                <option value="bank_transfer">{zh ? "转账" : "Virement"}</option>
                <option value="check">{zh ? "支票" : "Chèque"}</option>
                <option value="other">{zh ? "其他" : "Autre"}</option>
              </select>
            </label>
            <label>
              <span>{zh ? "结算开始日期（月初）" : "Début de période (premier du mois)"}</span>
              <input name="periodStart" type="date" required />
            </label>
            <label>
              <span>{zh ? "结算结束日期（月末）" : "Fin de période (dernier du mois)"}</span>
              <input name="periodEnd" type="date" required />
            </label>
            <label>
              <span>{zh ? "期初整厂结余（西法元 XOF）" : "Crédit global d’ouverture (XOF)"}</span>
              <input
                name="openingWholeCredit"
                type="number"
                required
                min="0"
                max="999999999999"
                step="1"
              />
            </label>
            <label>
              <span>{zh ? "期末整厂结余（西法元 XOF）" : "Crédit global de clôture (XOF)"}</span>
              <input
                name="closingWholeCredit"
                type="number"
                required
                min="0"
                max="999999999999"
                step="1"
              />
            </label>
            <label>
              <span>{zh ? "凭据来源" : "Source de la pièce"}</span>
              <input name="sourceRef" required maxLength={500} />
            </label>
            <label>
              <span>{zh ? "结算说明" : "Motif du règlement"}</span>
              <textarea name="reason" required maxLength={2000} />
            </label>
          </fieldset>
          {preview ? (
            <div className={detailStyles.attention} role="status">
              <p>
                {zh ? "本次实收" : "Encaissement"} {money(preview.input.amountNative)} ÷{" "}
                {preview.input.shareBps / 100}% = {zh ? "整厂等值" : "équivalent global"}{" "}
                {money(preview.wholeEquivalent)}
              </p>
              <p>
                {zh ? "整厂结算" : "Règlement global"}：{money(preview.input.openingWholeCredit)} +{" "}
                {money(preview.wholeEquivalent)} = {money(preview.wholeRent)} +{" "}
                {money(preview.input.closingWholeCredit)}
              </p>
              <p>
                {preview.monthCount} {zh ? "个完整自然月" : "mois civils entiers"} ·{" "}
                {preview.balanced
                  ? zh
                    ? "业主份额本期结清"
                    : "Quote-part du propriétaire soldée pour la période"
                  : zh
                    ? "等式未平，不能登记"
                    : "Équation non équilibrée"}
              </p>
            </div>
          ) : null}
          {unknown ? (
            <p className={detailStyles.attention}>
              {zh
                ? "保存结果未确认。已保留原请求并锁定表单，请按原请求重试核对，暂勿关闭此窗口。"
                : "Résultat non confirmé. Le formulaire est verrouillé ; réessayez la requête conservée avant de fermer cette fenêtre."}
            </p>
          ) : null}
          <div className={detailStyles.settlementButtons}>
            <button type="submit" disabled={busy}>
              {busy
                ? zh
                  ? "核对登记中…"
                  : "Enregistrement…"
                : unknown
                  ? zh
                    ? "按原请求重试核对"
                    : "Vérifier la même requête"
                  : zh
                    ? "确认登记结算"
                    : "Confirmer le règlement"}
            </button>
            {!pending ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setContext(null);
                  setPreview(null);
                  setError("");
                }}
              >
                {zh ? "取消" : "Annuler"}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
