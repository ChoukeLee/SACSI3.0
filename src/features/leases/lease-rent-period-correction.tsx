"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RightDrawer, controlClass } from "@/components/ui/operational";
import { DateInput } from "@/components/ui/date-input";
import { reviewLeaseRentPeriod, correctLeaseRentPeriod } from "./actions";
import { leaseRequestIdentity, clearLeaseRequestIdentity } from "./lease-request-identity";
import {
  parseLeaseRentPeriodInput,
  type LeaseRentPeriodInput,
  type LeaseRentPeriodReview,
} from "./lease-rent-period-model";

export function LeaseRentPeriodCorrection({
  contractId,
  locale,
  onSaved,
}: {
  contractId: string;
  locale: "zh" | "fr";
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<LeaseRentPeriodReview | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const [receivableId, setReceivableId] = useState("");
  const [paidThroughDate, setPaidThroughDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const inFlight = useRef(false);
  const submitted = useRef<{ requestId: string; input: LeaseRentPeriodInput } | null>(null);
  const zh = locale === "zh";
  async function show() {
    setOpen(true);
    setError("");
    setReview(null);
    try {
      const result = await reviewLeaseRentPeriod(contractId);
      if (result.success) setReview(result.data);
      else setError(result.error);
    } catch {
      setError(zh ? "读取失败，请关闭后重试。" : "Lecture impossible. Fermez puis réessayez.");
    }
  }
  async function save() {
    if (!review || inFlight.current) return;
    const input = submitted.current?.input ?? {
      expectedToken: review.token,
      paymentId,
      receivableId,
      paidThroughDate,
      reason,
    };
    try {
      parseLeaseRentPeriodInput(input);
    } catch {
      setError(
        zh
          ? "请选择原收款和已结账单，并填写日期与更正依据。"
          : "Sélectionnez le reçu et la créance, puis la date et le motif.",
      );
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const requestId =
        submitted.current?.requestId ??
        (await leaseRequestIdentity("correct-rent-period", contractId, input));
      submitted.current = { requestId, input };
      const result = await correctLeaseRentPeriod(contractId, input, requestId);
      if (result.success) {
        clearLeaseRequestIdentity("correct-rent-period", contractId);
        submitted.current = null;
        setUnresolved(false);
        setOpen(false);
        setPaymentId("");
        setReceivableId("");
        setPaidThroughDate("");
        setReason("");
        onSaved();
      } else {
        setError(result.error ?? "操作失败");
        setUnresolved(!result.rejected);
        if (result.rejected) {
          submitted.current = null;
          clearLeaseRequestIdentity("correct-rent-period", contractId);
        }
      }
    } catch {
      setUnresolved(true);
      setError(
        zh
          ? "结果未知：请保留本窗口，使用原请求重试，不能另录一笔。"
          : "Résultat inconnu : réessayez la même demande, sans créer un autre reçu.",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={show}>
        {zh ? "更正租金账期" : "Corriger la période"}
      </Button>
      <RightDrawer
        open={open}
        title={zh ? "更正历史租金账期" : "Corriger une période de loyer"}
        onClose={() => {
          if (!saving && !unresolved) setOpen(false);
        }}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          {zh
            ? "仅管理员可操作。只支持一笔租金收款及其唯一已结账单；多笔收款或复杂核销会拒绝。不会新增收款，不改原币、金额、收款日、付款方式、押金或正式合同日期。"
            : "Administrateur uniquement. Un reçu de loyer et une créance soldée uniques. Aucun nouvel encaissement ni changement des montants, devises, dates, dépôts ou contrat."}
        </p>
        {error && (
          <p role="alert" className="mb-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {!review ? (
          !error && <p>{zh ? "正在读取账务快照…" : "Chargement…"}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              {zh ? "当前已缴至：" : "Payé au : "}
              {review.paidThroughDate ?? "-"}
            </p>
            <fieldset disabled={saving || unresolved} className="space-y-4">
              <label className="block text-sm">
                {zh ? "原租金收款" : "Reçu de loyer"}
                <select
                  className={`${controlClass} w-full`}
                  value={paymentId}
                  onChange={(e) => setPaymentId(e.target.value)}
                >
                  <option value="">{zh ? "请选择，不自动匹配" : "Sélection explicite"}</option>
                  {review.payments.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.paymentDate} | {p.amount.toLocaleString()} {p.currency} |{" "}
                      {p.receiptNo ?? p.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {zh ? "对应已结租金账单" : "Créance de loyer soldée"}
                <select
                  className={`${controlClass} w-full`}
                  value={receivableId}
                  onChange={(e) => setReceivableId(e.target.value)}
                >
                  <option value="">{zh ? "请选择原账单" : "Sélectionner"}</option>
                  {review.receivables.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} | {r.amountXof.toLocaleString()} XOF |{" "}
                      {r.periodEnd ?? (zh ? "原覆盖期未确认" : "Période inconnue")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {zh ? "该笔实际缴至日期" : "Date réellement couverte"}
                <DateInput value={paidThroughDate} onChangeValue={setPaidThroughDate} />
              </label>
              <label className="block text-sm">
                {zh ? "更正依据（必填）" : "Motif obligatoire"}
                <textarea
                  className={`${controlClass} min-h-24 w-full`}
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </fieldset>
            {paidThroughDate && (
              <p className="rounded border p-3 text-sm">
                {zh
                  ? `已缴至 ${review.paidThroughDate ?? "未登记"} → ${paidThroughDate}。旧的未收自动后续账单将取消并保留历史，按新截止日重建下一期；原付款事实保留，已收金额不变。`
                  : `Payé au : ${review.paidThroughDate ?? "-"} → ${paidThroughDate}. L'échéance automatique non encaissée sera remplacée, sans modifier les encaissements.`}
              </p>
            )}
            {submitted.current && (
              <p className="break-all text-xs text-muted-foreground">
                {zh ? "操作编号：" : "Demande : "}
                {submitted.current.requestId}
              </p>
            )}
            <Button
              onClick={save}
              disabled={
                saving ||
                (!unresolved && (!paymentId || !receivableId || !paidThroughDate || !reason.trim()))
              }
            >
              {saving
                ? "…"
                : unresolved
                  ? zh
                    ? "原样重试，核对原结果"
                    : "Réessayer la même demande"
                  : zh
                    ? "确认更正账期（不新增收款）"
                    : "Confirmer sans nouvel encaissement"}
            </Button>
          </div>
        )}
      </RightDrawer>
    </>
  );
}
