"use client";

import { useCallback, useEffect, useState } from "react";
import type { FinanceKind } from "./finance-read";
import { decodeFinanceRecordContext, type FinanceRecordContext } from "./finance-record-context";
import {
  decodePaymentContext,
  validPaymentContextId,
  type PaymentContext,
} from "./payment-context";

export interface FinanceWorkbenchContext {
  record: FinanceRecordContext;
  payment: PaymentContext | null;
}

/** Selected-record reads only; no list cache or business mutation is shared here. */
export function useFinanceWorkbenchContext({
  kind,
  recordId,
  paymentId,
  scopeKey,
}: {
  kind: FinanceKind;
  recordId: string | null;
  paymentId: string | null;
  scopeKey: string;
}) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: FinanceWorkbenchContext | null;
    error: boolean;
  } | null>(null);
  const key = recordId ? JSON.stringify([scopeKey, kind, recordId, paymentId, revision]) : null;

  useEffect(() => {
    if (!recordId || !key) return;
    const controller = new AbortController();
    let active = true;

    async function readPayment(id: string) {
      if (!validPaymentContextId(id)) throw new Error("FinanceContextTargetMismatch");
      const response = await fetch(`/api/finance/payment-context/${encodeURIComponent(id)}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("FinanceContextUnavailable");
      const payment = decodePaymentContext(await response.json());
      if (payment.paymentId !== id) throw new Error("FinanceContextTargetMismatch");
      return payment;
    }

    async function read() {
      if (!validPaymentContextId(recordId!)) throw new Error("FinanceContextTargetMismatch");
      // An explicitly linked list payment is independent of the source read, so start both.
      // Catch immediately: a fast failed payment read must not become an unhandled rejection.
      const paymentRead = paymentId
        ? readPayment(paymentId).then(
            (value) => ({ value, error: false as const }),
            () => ({ value: null, error: true as const }),
          )
        : null;
      const params = new URLSearchParams({ kind, id: recordId! });
      const response = await fetch(`/api/finance/record-context?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("FinanceContextUnavailable");
      const record = decodeFinanceRecordContext(await response.json());
      if (!active || controller.signal.aborted) throw new Error("FinanceContextAborted");
      if (record.kind !== kind || record.id !== recordId)
        throw new Error("FinanceContextTargetMismatch");
      if (paymentId && record.paymentId !== paymentId)
        throw new Error("FinanceContextTargetMismatch");

      let payment: PaymentContext | null = null;
      if (paymentRead) {
        const loaded = await paymentRead;
        if (loaded.error) throw new Error("FinanceContextUnavailable");
        payment = loaded.value;
      } else if (record.paymentId) {
        payment = await readPayment(record.paymentId);
      }
      if (
        payment &&
        ((payment.unitId && record.unit && payment.unitId !== record.unit.id) ||
          (payment.buildingId && record.building && payment.buildingId !== record.building.id))
      )
        throw new Error("FinanceContextTargetMismatch");
      return { record, payment };
    }

    void read()
      .then((data) => {
        if (active) setResult({ key, data, error: false });
      })
      .catch(() => {
        if (active) setResult({ key, data: null, error: true });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [kind, recordId, paymentId, scopeKey, key]);

  const current = key && result?.key === key ? result : null;
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return {
    data: current?.data ?? null,
    loading: Boolean(key && !current),
    error: current?.error ?? false,
    reload,
  };
}
