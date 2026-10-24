"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearBusinessRequestIdentity } from "@/lib/business-request-identity";
import { runFinanceRequest } from "./finance-request";
import { readCimacWriteReceipt } from "./cimac-billing-actions";
import type { CimacBillingWriteKind, CimacBillingWriteResult } from "./cimac-billing-types";
import styles from "./cimac-customer-workbench.module.css";

type Success = CimacBillingWriteResult & { success: true };
type Result = Success | { success: false; error: string; rejected: boolean };
type Phase = "checking" | "editing" | "submitting" | "unknown" | "rejected" | "success";
type Pending =
  { status: "none" } | { status: "pending"; requestId: string } | { status: "unavailable" };

function readPending(operation: string, target: string): Pending {
  try {
    const raw = sessionStorage.getItem(`sacsi:finance-request:v1:${operation}:${target}`);
    if (raw === null) return { status: "none" };
    const item: unknown = JSON.parse(raw);
    if (!item || typeof item !== "object" || Array.isArray(item)) return { status: "unavailable" };
    const value = item as Record<string, unknown>;
    return typeof value.requestId === "string" &&
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.requestId) &&
      typeof value.fingerprint === "string" &&
      /^[0-9a-f]{64}$/i.test(value.fingerprint)
      ? { status: "pending", requestId: value.requestId }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Preserve identity and the in-memory original payload after an ambiguous write. */
export function useCimacWrite<T>({
  kind,
  viewerId,
  customerId,
  originalPaymentId,
  locale,
  action,
}: {
  kind: CimacBillingWriteKind;
  viewerId: string;
  customerId: string;
  originalPaymentId?: string;
  locale: "zh" | "fr";
  action: (input: T & { requestId: string }) => Promise<Result>;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const router = useRouter();
  const correctionFamily = kind === "refund" || kind === "reversal";
  // A refund with an unknown outcome must also block a reversal of the same
  // receipt, including after closing/reopening the panel or changing the kind.
  const operation = correctionFamily ? "cimac_adjustment" : `cimac_${kind}`;
  const target = `${viewerId}:${customerId}${correctionFamily ? `:${originalPaymentId ?? "missing"}` : ""}`;
  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Success | null>(null);
  const [recovering, setRecovering] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const original = useRef<T | null>(null);
  useEffect(() => {
    mounted.current = true;
    if (
      correctionFamily &&
      (!originalPaymentId ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(originalPaymentId))
    ) {
      setPhase("unknown");
      setMessage(
        locale === "zh"
          ? "缺少可核验的原收款标识，不能办理退款或冲正。"
          : "Identifiant du paiement d’origine manquant : remboursement ou annulation impossible.",
      );
      return () => {
        mounted.current = false;
      };
    }
    const pending = readPending(operation, target);
    if (pending.status === "none") setPhase("editing");
    else {
      setPhase("unknown");
      if (pending.status === "pending") setRequestId(pending.requestId);
      setMessage(
        locale === "zh"
          ? "检测到未核实的操作结果。请先查询原操作回执，不要另起一笔。"
          : "Une opération reste à vérifier. Recherchez son reçu sans créer une nouvelle opération.",
      );
    }
    return () => {
      mounted.current = false;
    };
  }, [operation, target, locale, correctionFamily, originalPaymentId]);

  async function submit(payload: T) {
    if (busy.current || phase === "checking" || phase === "success") return;
    if (phase === "unknown" && original.current === null) return;
    busy.current = true;
    const input = phase === "unknown" ? original.current! : payload;
    original.current = input;
    setPhase("submitting");
    setMessage("");
    try {
      const result = await runFinanceRequest(
        operation,
        target,
        input,
        async (id): Promise<Result> => {
          if (mounted.current) setRequestId(id);
          const response = await action({ ...input, requestId: id });
          if (
            response.success &&
            (response.requestId !== id ||
              response.customerId !== customerId ||
              response.actorId !== viewerId ||
              response.kind !== kind ||
              (correctionFamily && response.originalPaymentId !== originalPaymentId))
          )
            return {
              success: false,
              rejected: false,
              error: text(
                "回执与当前操作不匹配，请联系核对，勿另起请求。",
                "Le reçu ne correspond pas à cette opération. Faites vérifier sans créer une nouvelle requête.",
              ),
            };
          return response;
        },
      );
      if (!mounted.current) return;
      if (result.success) {
        if (
          result.customerId !== customerId ||
          result.actorId !== viewerId ||
          result.kind !== kind ||
          (correctionFamily && result.originalPaymentId !== originalPaymentId)
        ) {
          setPhase("unknown");
          setMessage(
            text(
              "回执与当前操作不匹配，请联系核对，勿另起请求。",
              "Le reçu ne correspond pas à cette opération. Faites vérifier sans créer une nouvelle requête.",
            ),
          );
          return;
        }
        original.current = null;
        setReceipt(result);
        setPhase("success");
        router.refresh();
      } else {
        setPhase(result.rejected ? "rejected" : "unknown");
        setMessage(
          locale === "zh"
            ? result.error
            : "L’opération n’a pas de résultat vérifié. Conservez son identifiant et son contenu ; recherchez le reçu ou réessayez à l’identique, sans créer une autre opération.",
        );
        if (result.rejected) {
          original.current = null;
          router.refresh();
        }
      }
    } catch {
      if (mounted.current) {
        setPhase("unknown");
        setMessage(
          text(
            "结果尚未核实，原操作号和内容已保留。请查询回执，或按原内容同号重试；不要另起一笔。",
            "Résultat non vérifié. L’identifiant et le contenu d’origine sont conservés. Recherchez le reçu ou réessayez à l’identique, sans nouvelle opération.",
          ),
        );
      }
    } finally {
      busy.current = false;
    }
  }

  async function recover() {
    if (!requestId || busy.current) return;
    busy.current = true;
    setRecovering(true);
    try {
      const result = await readCimacWriteReceipt(requestId);
      if (!mounted.current) return;
      if (result.status === "found") {
        const value = result.receipt;
        const pending = readPending(operation, target);
        if (
          value.requestId !== requestId ||
          value.customerId !== customerId ||
          value.actorId !== viewerId ||
          (correctionFamily
            ? !["refund", "reversal"].includes(value.kind) ||
              value.originalPaymentId !== originalPaymentId
            : value.kind !== kind) ||
          pending.status !== "pending" ||
          pending.requestId !== requestId
        ) {
          setMessage(
            text(
              "回执或本机操作标识不匹配，继续锁定，请联系核对。",
              "Le reçu ou l’identifiant local ne correspond pas. Verrouillage conservé ; faites vérifier.",
            ),
          );
          return;
        }
        clearBusinessRequestIdentity("finance", operation, target);
        original.current = null;
        setReceipt({ ...value, success: true });
        setMessage("");
        setPhase("success");
        router.refresh();
      } else {
        setMessage(
          result.status === "unavailable"
            ? text(
                result.error,
                "La recherche du reçu est indisponible. L’identifiant d’origine est conservé.",
              )
            : text(
                "暂未查到回执，原请求仍可能在处理中。这不代表未入账；请稍后重查或联系核对。",
                "Aucun reçu trouvé pour le moment. La requête peut être en cours : cela ne prouve pas l’absence d’enregistrement. Réessayez la recherche ou faites vérifier.",
              ),
        );
      }
    } catch {
      if (mounted.current)
        setMessage(
          text(
            "回执查询失败，原操作号保留，请稍后重查。",
            "Recherche du reçu échouée. Identifiant conservé ; réessayez plus tard.",
          ),
        );
    } finally {
      busy.current = false;
      if (mounted.current) setRecovering(false);
    }
  }

  function reset() {
    if (phase !== "success" && phase !== "rejected") return;
    setReceipt(null);
    setRequestId(null);
    setMessage("");
    setPhase("editing");
  }
  return {
    phase,
    message,
    requestId,
    receipt,
    submit,
    recover,
    recovering,
    reset,
    locked: !["editing", "rejected"].includes(phase),
    canRetry: phase === "unknown" && original.current !== null,
  };
}

export function CimacWriteFeedback({
  state,
  locale,
  onRetry,
}: {
  state: Pick<
    ReturnType<typeof useCimacWrite>,
    "phase" | "message" | "requestId" | "receipt" | "recover" | "recovering" | "canRetry"
  >;
  locale: "zh" | "fr";
  onRetry?: () => void;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  return (
    <div aria-live="polite">
      {state.phase === "checking" ? (
        <p className={styles.note}>
          {text("正在检查未完成操作…", "Vérification des opérations en attente…")}
        </p>
      ) : null}
      {state.message ? (
        <p className={styles.feedback} role={state.phase === "rejected" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}
      {state.phase === "success" && state.receipt ? (
        <p role="status" className={styles.feedback}>
          {text("已保存，审计与操作号可追溯。", "Enregistré, avec audit et identifiant traçables.")}{" "}
          {state.receipt.receiptNo ?? state.receipt.entityId}
        </p>
      ) : null}
      {state.phase === "unknown" ? (
        <div className={styles.actions}>
          {state.requestId ? (
            <>
              <p className={styles.meta}>
                {text("操作号", "Opération")} · {state.requestId}
              </p>
              <button
                type="button"
                className={styles.button}
                disabled={state.recovering}
                onClick={() => void state.recover()}
              >
                {state.recovering
                  ? text("正在查询…", "Recherche…")
                  : text("查询原操作回执", "Rechercher le reçu")}
              </button>
            </>
          ) : null}
          {state.canRetry && onRetry ? (
            <button
              type="button"
              className={styles.button}
              disabled={state.recovering}
              onClick={onRetry}
            >
              {text("按原内容同号重试", "Réessayer à l’identique")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
