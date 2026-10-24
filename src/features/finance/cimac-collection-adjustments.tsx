"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  readCimacCollectionPosition,
  recordCimacRefund,
  reverseCimacCollection,
} from "./cimac-billing-actions";
import type {
  CimacCollectionAdjustmentKind,
  CimacCollectionPosition,
  CimacRefundInput,
  CimacReversalInput,
} from "./cimac-billing-types";
import { billingMinor, billingMinorString, billingNumber } from "./cimac-billing-display";
import { CimacWriteFeedback, useCimacWrite } from "./cimac-write-form";
import { parseCimacRefundInput, parseCimacReversalInput } from "./cimac-billing-service";
import styles from "./cimac-customer-workbench.module.css";

interface Props {
  originalPaymentId: string;
  customerId: string;
  viewerId: string;
  locale: "zh" | "fr";
  today: string;
  canWrite: boolean;
  unitLabels?: Readonly<Record<string, string>>;
  contractLabels?: Readonly<Record<string, string>>;
}

/** Read positions only on demand; keep mounted after closing to preserve an ambiguous write. */
export function CimacCollectionAdjustments(props: Props) {
  const [visited, setVisited] = useState(false);
  return (
    <details
      className={styles.corrections}
      onToggle={(event) => {
        if (event.currentTarget.open) setVisited(true);
      }}
    >
      <summary>
        {props.locale === "zh"
          ? "退款、冲正与历史"
          : "Remboursement, contrepassation et historique"}
      </summary>
      {visited ? <AdjustmentContent {...props} /> : null}
    </details>
  );
}

function paymentMethodLabel(value: string, locale: "zh" | "fr") {
  const values: Record<string, [string, string]> = {
    cash: ["现金", "Espèces"],
    check: ["支票", "Chèque"],
    bank_transfer: ["银行转账", "Virement bancaire"],
    other: ["其他方式", "Autre moyen"],
    offset: ["非现金冲正", "Contrepassation sans mouvement de fonds"],
  };
  return values[value]?.[locale === "zh" ? 0 : 1] ?? (locale === "zh" ? "待核" : "À vérifier");
}

function AdjustmentContent({
  originalPaymentId,
  customerId,
  viewerId,
  locale,
  today,
  canWrite,
  unitLabels,
  contractLabels,
}: Props) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const [position, setPosition] = useState<CimacCollectionPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [operation, setOperation] = useState<CimacCollectionAdjustmentKind | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [method, setMethod] = useState<CimacRefundInput["paymentMethod"] | "">("");
  const [externalReceiptNo, setExternalReceiptNo] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState("");
  const feedback = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const submitted = useRef<CimacRefundInput | CimacReversalInput | null>(null);
  const write = useCimacWrite<CimacRefundInput | CimacReversalInput>({
    kind: operation ?? "refund",
    originalPaymentId,
    customerId,
    viewerId,
    locale,
    action: (input) =>
      "paymentDate" in input ? recordCimacRefund(input) : reverseCimacCollection(input),
  });

  async function loadPosition() {
    setLoading(true);
    setReadError("");
    try {
      const result = await readCimacCollectionPosition(originalPaymentId);
      if (!mounted.current) return;
      if (
        result.status === "available" &&
        result.position.originalPaymentId === originalPaymentId &&
        result.position.customerId === customerId
      ) {
        setPosition(result.position);
      } else {
        setPosition(null);
        setReadError(
          text(
            "暂时无法核实原收款及剩余分账。请重新读取，不会按零或旧余额办理。",
            "Le reçu et les affectations restantes ne sont pas vérifiés. Rechargez ; aucun solde nul ou périmé ne sera utilisé.",
          ),
        );
      }
    } catch {
      if (mounted.current) {
        setPosition(null);
        setReadError(text("读取失败，请重试。", "Lecture indisponible ; réessayez."));
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void readCimacCollectionPosition(originalPaymentId)
      .then((result) => {
        if (!active) return;
        if (
          result.status === "available" &&
          result.position.originalPaymentId === originalPaymentId &&
          result.position.customerId === customerId
        )
          setPosition(result.position);
        else
          setReadError(
            locale === "zh"
              ? "暂时无法核实原收款及剩余分账。请重新读取，不会按零或旧余额办理。"
              : "Le reçu et les affectations restantes ne sont pas vérifiés. Rechargez ; aucun solde nul ou périmé ne sera utilisé.",
          );
      })
      .catch(() => {
        if (active)
          setReadError(
            locale === "zh" ? "读取失败，请重试。" : "Lecture indisponible ; réessayez.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [originalPaymentId, customerId, locale]);

  const refundEntries =
    position?.allocations.map((row) => ({
      row,
      raw: allocations[row.receivableId] ?? "",
      minor: allocations[row.receivableId]
        ? billingMinor(allocations[row.receivableId])
        : BigInt(0),
    })) ?? [];
  const allocationTotal = refundEntries.every((entry) => entry.minor !== null)
    ? refundEntries.reduce((sum, entry) => sum + entry.minor!, BigInt(0))
    : null;
  const locked = write.locked || !canWrite || loading || !position;
  const canChoose = canWrite && !write.locked && !loading && !!position;
  const allocationLabels = new Map(
    position?.allocations.map((row) => [
      row.receivableId,
      `${unitLabels?.[row.unitId] ?? text("房屋待核", "Lot à vérifier")} · ${row.title} · ${contractLabels?.[row.contractId] ?? text("合同待核", "Contrat à vérifier")}`,
    ]),
  );

  function choose(kind: CimacCollectionAdjustmentKind) {
    if (!canChoose || (kind === "refund" ? !position?.canRefund : !position?.canReverse)) return;
    setOperation(kind);
    setValidation("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || !position || !operation) return;
    const amountMinor =
      operation === "reversal" ? billingMinor(position.originalAmount) : billingMinor(amount);
    const selected =
      operation === "reversal"
        ? position.allocations.map((row) => ({ row, minor: billingMinor(row.remainingAmount) }))
        : refundEntries.filter((entry) => entry.minor !== null && entry.minor > BigInt(0));
    let error = "";
    if (!reason.trim())
      error = text("请填写这次操作的实际原因。", "Indiquez le motif réel de cette opération.");
    else if (!amountMinor || amountMinor % BigInt(100) !== BigInt(0))
      error = text("金额须为大于零的 XOF 整数。", "Le montant XOF doit être un entier positif.");
    else if (
      operation === "refund" &&
      (!position.canRefund ||
        !method ||
        !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
        paymentDate < position.originalPaymentDate ||
        paymentDate > today)
    )
      error = text(
        "请填写已实际退款的日期与方式；日期不能早于原收款或晚于今天。",
        "Indiquez la date et le moyen du remboursement effectué, entre l’encaissement d’origine et aujourd’hui.",
      );
    else if (operation === "reversal" && !position.canReverse)
      error = text(
        "原收款已退款或不可整单冲正，请重新核对。",
        "Le reçu a déjà été remboursé ou ne peut être contrepassé intégralement.",
      );
    else if (
      !selected.length ||
      selected.some(
        (entry) =>
          entry.minor === null ||
          entry.minor <= BigInt(0) ||
          entry.minor % BigInt(100) !== BigInt(0) ||
          billingMinor(entry.row.remainingAmount) === null ||
          entry.minor > billingMinor(entry.row.remainingAmount)!,
      ) ||
      selected.reduce((sum, entry) => sum + (entry.minor ?? BigInt(0)), BigInt(0)) !==
        amountMinor ||
      (operation === "refund" &&
        (allocationTotal !== amountMinor ||
          amountMinor > (billingMinor(position.remainingAmount) ?? BigInt(0))))
    )
      error = text(
        "请明确退款分账：各项为 XOF 整数、不超过原单剩余份额，合计必须等于实际退款。",
        "Précisez chaque part remboursée : un entier XOF dans sa limite restante, pour un total égal au remboursement réel.",
      );
    setValidation(error);
    if (error || !amountMinor) {
      requestAnimationFrame(() => feedback.current?.focus());
      return;
    }
    const common: CimacReversalInput = {
      originalPaymentId,
      customerId,
      currency: "XOF",
      amount: billingMinorString(amountMinor),
      reason: reason.trim(),
      expectedPositionToken: position.positionToken,
      allocations: selected.map(({ row, minor }) => ({
        receivableId: row.receivableId,
        amount: billingMinorString(minor!),
        expectedRemaining: row.remainingAmount,
        expectedPaid: row.paidAmount,
        expectedUpdatedAt: row.updatedAt,
      })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    const input: CimacRefundInput | CimacReversalInput =
      operation === "refund" && method
        ? {
            ...common,
            paymentDate,
            paymentMethod: method,
            ...(externalReceiptNo.trim() ? { externalReceiptNo: externalReceiptNo.trim() } : {}),
          }
        : common;
    try {
      // Pure preflight only: the real durable identity is created by the write hook.
      const checked = { ...input, requestId: "00000000-0000-4000-8000-000000000000" };
      if ("paymentDate" in input) parseCimacRefundInput(checked);
      else parseCimacReversalInput(checked);
    } catch {
      setValidation(
        text(
          "输入与当前分账快照不符，请核对日期、金额及必填事实。",
          "Les données ne correspondent pas à l’état des affectations. Vérifiez dates, montants et faits requis.",
        ),
      );
      requestAnimationFrame(() => feedback.current?.focus());
      return;
    }
    submitted.current = input;
    await write.submit(input);
    requestAnimationFrame(() => feedback.current?.focus());
  }

  async function refreshAfterCompleted() {
    if (write.phase !== "success" && write.phase !== "rejected") return;
    await loadPosition();
    if (!mounted.current) return;
    write.reset();
    setOperation(null);
    setAmount("");
    setPaymentDate("");
    setMethod("");
    setExternalReceiptNo("");
    setReason("");
    setNotes("");
    setAllocations({});
    setValidation("");
    submitted.current = null;
  }

  return (
    <div
      className={styles.correctionBody}
      aria-label={text("原收款校正", "Correction du reçu d’origine")}
    >
      {loading ? (
        <p role="status" className={styles.note}>
          {text("正在核实原单及校正链…", "Vérification du reçu et de son historique…")}
        </p>
      ) : null}
      {readError ? (
        <p role="alert" className={styles.note}>
          {readError}
        </p>
      ) : null}
      {!position && !loading ? (
        <button type="button" className={styles.quietButton} onClick={() => void loadPosition()}>
          {text("重新读取", "Recharger")}
        </button>
      ) : null}
      {position ? (
        <>
          <div className={styles.correctionBalance}>
            <span>
              {text("原收款", "Reçu d’origine")}{" "}
              <strong>{billingNumber(position.originalAmount, locale)} XOF</strong>
            </span>
            <span>
              {text("已实际退款", "Déjà remboursé")}{" "}
              <strong>{billingNumber(position.refundedAmount, locale)} XOF</strong>
            </span>
            <span>
              {text("原单未调整余额 · 读取时", "Part non corrigée · à la lecture")}{" "}
              <strong>{billingNumber(position.remainingAmount, locale)} XOF</strong>
            </span>
          </div>
          <p className={styles.meta}>
            {position.originalReceiptNo ?? originalPaymentId} · {position.originalPaymentDate} ·{" "}
            {paymentMethodLabel(position.originalPaymentMethod, locale)}
          </p>
          {position.adjustments.length ? (
            <ol
              className={styles.correctionHistory}
              aria-label={text("原单校正链", "Historique des corrections")}
            >
              {position.adjustments.map((adjustment) => (
                <li
                  className={styles.correctionEvent}
                  key={adjustment.id}
                  id={`cimac-adjustment-${adjustment.paymentId}`}
                >
                  <div className={styles.correctionEventHeader}>
                    <strong>
                      {adjustment.kind === "refund"
                        ? text("实际退款登记", "Remboursement réel enregistré")
                        : text(
                            "错误收款冲正 · 非现金",
                            "Contrepassation d’une erreur · hors caisse",
                          )}
                    </strong>
                    <span>{billingNumber(adjustment.amount, locale)} XOF</span>
                  </div>
                  <p className={styles.meta}>
                    {adjustment.paymentDate} ·{" "}
                    {paymentMethodLabel(adjustment.paymentMethod, locale)} ·{" "}
                    {adjustment.receiptNo ?? adjustment.paymentId}
                  </p>
                  <p className={styles.correctionReason}>{adjustment.reason}</p>
                  <p className={styles.meta}>
                    {text("录入账号", "Opérateur")} · {adjustment.recordedBy} ·{" "}
                    {text("记录于", "Enregistré le")} {adjustment.createdAt}
                  </p>
                  <ul className={styles.correctionHistory}>
                    {adjustment.allocations.map((line) => (
                      <li className={styles.meta} key={line.receivableId}>
                        {allocationLabels.get(line.receivableId) ??
                          text("关联房屋与账单待核", "Lot et créance liés à vérifier")}{" "}
                        · {billingNumber(line.amount, locale)} XOF
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.note}>
              {text(
                "尚无退款或冲正；原始收款及分账仍完整保留。",
                "Aucune correction. Le reçu et ses affectations d’origine restent conservés.",
              )}
            </p>
          )}
        </>
      ) : null}
      <div ref={feedback} tabIndex={-1}>
        <CimacWriteFeedback
          state={write}
          locale={locale}
          onRetry={() => submitted.current && void write.submit(submitted.current)}
        />
        {validation ? (
          <p role="alert" className={styles.feedback}>
            {validation}
          </p>
        ) : null}
        {write.phase === "success" && write.receipt ? (
          <p className={styles.note} role="status">
            {write.receipt.kind === "refund"
              ? text(
                  "实际退款已登记，相关应收已恢复；未自动减免合同欠款。",
                  "Remboursement réel enregistré et créances rétablies ; aucune dette contractuelle n’a été remise.",
                )
              : text(
                  "错误收款已整单冲正，相关应收已恢复；没有登记实际退款。",
                  "Encaissement erroné contrepassé intégralement ; créances rétablies, sans remboursement réel.",
                )}
            {write.receipt.remainingAfter !== undefined
              ? ` ${text("本次完成后原单未调整余额", "Part non corrigée après cette opération")} · ${billingNumber(write.receipt.remainingAfter, locale)} XOF`
              : null}
          </p>
        ) : null}
      </div>
      {canWrite && position ? (
        <>
          {write.phase === "success" || write.phase === "rejected" ? (
            <button
              type="button"
              className={styles.quietButton}
              disabled={loading}
              onClick={() => void refreshAfterCompleted()}
            >
              {text("刷新原单余额与校正链", "Actualiser le solde et l’historique")}
            </button>
          ) : null}
          <div
            className={styles.correctionChoice}
            role="group"
            aria-label={text("选择校正类型", "Choisir le type de correction")}
          >
            <button
              type="button"
              disabled={!canChoose || !position.canRefund}
              aria-pressed={operation === "refund"}
              onClick={() => choose("refund")}
            >
              <strong>{text("登记实际退款", "Enregistrer un remboursement réel")}</strong>
              <span>
                {text(
                  "钱已经退给客户；可按明确分账部分退款",
                  "Fonds déjà rendus ; remboursement partiel avec répartition explicite",
                )}
              </span>
            </button>
            <button
              type="button"
              disabled={!canChoose || !position.canReverse}
              aria-pressed={operation === "reversal"}
              onClick={() => choose("reversal")}
            >
              <strong>{text("冲正错误收款", "Contrepasser un encaissement erroné")}</strong>
              <span>
                {text(
                  "整笔录错的账务纠正；不是现金退款",
                  "Corriger un reçu erroné en entier ; aucun remboursement réel",
                )}
              </span>
            </button>
          </div>
          {!position.canReverse && position.refundedAmount !== "0" ? (
            <p className={styles.note}>
              {text(
                "原单已有实际退款，不能再整单冲正。",
                "Ce reçu a déjà été remboursé ; la contrepassation intégrale n’est plus possible.",
              )}
            </p>
          ) : null}
          {!position.canRefund && billingMinor(position.remainingAmount) !== BigInt(0) ? (
            <p className={styles.note}>
              {text(
                "原单仍有未调整份额，但当前账务状态不允许退款；请先核对，不能把该余额直接作为可退额。",
                "Une part non corrigée subsiste, mais l’état comptable ne permet pas un remboursement. Vérifiez-la ; ce solde ne constitue pas un montant remboursable.",
              )}
            </p>
          ) : null}
          {operation ? (
            <form className={styles.correctionForm} onSubmit={(event) => void submit(event)}>
              <p className={styles.note}>
                {operation === "refund"
                  ? text(
                      "只登记已实际退给客户的钱，不执行银行转账。退款会减少原核销、恢复应收，不自动免除合同义务。",
                      "Enregistre uniquement des fonds déjà rendus, sans effectuer de virement. Les imputations sont réduites et les créances rétablies, sans remise des obligations contractuelles.",
                    )
                  : text(
                      "整单纠正原收款录错，不是实际退款。生效日期沿用原收款日，操作时间按当前审计记录；原单不会删除。",
                      "Corrige intégralement un encaissement erroné, sans remboursement réel. La date d’effet reste celle du reçu d’origine ; l’audit conserve l’heure actuelle. Le reçu n’est pas supprimé.",
                    )}
              </p>
              <fieldset className={styles.fieldset} disabled={locked}>
                {operation === "refund" ? (
                  <div className={styles.formColumns}>
                    <label className={styles.field}>
                      <span>{text("已实际退回 · XOF", "Montant déjà remboursé · XOF")}</span>
                      <input
                        className={styles.input}
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        max={position.remainingAmount}
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        required
                      />
                    </label>
                    <label className={styles.field}>
                      <span>{text("实际退款日期", "Date réelle du remboursement")}</span>
                      <input
                        className={styles.input}
                        type="date"
                        min={position.originalPaymentDate}
                        max={today}
                        value={paymentDate}
                        onChange={(event) => setPaymentDate(event.target.value)}
                        required
                      />
                    </label>
                    <label className={styles.field}>
                      <span>{text("实际退款方式", "Moyen réel du remboursement")}</span>
                      <select
                        className={styles.select}
                        value={method}
                        onChange={(event) => setMethod(event.target.value as typeof method)}
                        required
                      >
                        <option value="">{text("请选择", "Choisir")}</option>
                        {["cash", "check", "bank_transfer", "other"].map((value) => (
                          <option key={value} value={value}>
                            {paymentMethodLabel(value, locale)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>
                        {text("退款凭证号，可留空", "Référence du remboursement, facultative")}
                      </span>
                      <input
                        className={styles.input}
                        maxLength={200}
                        value={externalReceiptNo}
                        onChange={(event) => setExternalReceiptNo(event.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <p className={styles.correctionBalance}>
                    <span>
                      {text("整单冲正 · 非现金", "Contrepassation intégrale · hors caisse")}{" "}
                      <strong>{billingNumber(position.originalAmount, locale)} XOF</strong>
                    </span>
                  </p>
                )}
                <div
                  aria-label={text("本次恢复的应收分账", "Créances rétablies par cette correction")}
                >
                  <div className={`${styles.allocationRow} ${styles.note}`}>
                    <span>{text("房屋 / 合同 / 账单", "Lot / contrat / créance")}</span>
                    <span className={styles.number}>{text("原分配", "Part d’origine")}</span>
                    <span className={styles.number}>
                      {text("本次恢复 · XOF", "À rétablir · XOF")}
                    </span>
                  </div>
                  {position.allocations.map((row) => (
                    <div className={styles.allocationRow} key={row.receivableId}>
                      <div>
                        {allocationLabels.get(row.receivableId)}
                        <p className={styles.meta}>
                          {text("原单剩余份额", "Part restante du reçu")} ·{" "}
                          {billingNumber(row.remainingAmount, locale)} XOF
                        </p>
                      </div>
                      <span className={`${styles.number} ${styles.muted}`}>
                        {billingNumber(row.originalAmount, locale)}
                      </span>
                      {operation === "refund" ? (
                        <label className={styles.field}>
                          <span
                            className={styles.srOnly}
                          >{`${allocationLabels.get(row.receivableId)} ${text("退款分配", "part remboursée")}`}</span>
                          <input
                            className={styles.input}
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            max={row.remainingAmount}
                            disabled={billingMinor(row.remainingAmount) === BigInt(0)}
                            value={allocations[row.receivableId] ?? ""}
                            onChange={(event) =>
                              setAllocations((current) => ({
                                ...current,
                                [row.receivableId]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ) : (
                        <span className={styles.number}>
                          {billingNumber(row.remainingAmount, locale)} XOF
                        </span>
                      )}
                    </div>
                  ))}
                  {operation === "refund" ? (
                    <p className={styles.note}>
                      {text("本次明确分配合计", "Total explicitement réparti")} ·{" "}
                      {allocationTotal === null
                        ? "—"
                        : billingNumber(billingMinorString(allocationTotal), locale)}{" "}
                      XOF
                    </p>
                  ) : null}
                </div>
                <label className={styles.field}>
                  <span>{text("实际原因 · 必填", "Motif réel · obligatoire")}</span>
                  <textarea
                    className={styles.input}
                    maxLength={1000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("补充备注，可留空", "Note complémentaire, facultative")}</span>
                  <textarea
                    className={styles.input}
                    maxLength={2000}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </label>
              </fieldset>
              <div className={styles.actions}>
                <button type="submit" className={styles.primaryButton} disabled={locked}>
                  {write.phase === "submitting"
                    ? text("正在核验并登记…", "Vérification et enregistrement…")
                    : operation === "refund"
                      ? text("登记这笔已实际退款", "Enregistrer ce remboursement effectué")
                      : text("整单冲正这笔错误收款", "Contrepasser ce reçu erroné en entier")}
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
