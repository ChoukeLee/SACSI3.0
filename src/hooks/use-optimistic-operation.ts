"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type OptimisticOperationState = "syncing" | "done" | "failed";

export interface OptimisticOperation {
  label: string;
  state: OptimisticOperationState;
}

export type OptimisticOperationResult = {
  success: boolean;
  error?: string;
};

export type BackgroundOperationReporter = (label: string, state: OptimisticOperationState) => void;

export function useBackgroundOperationStatus(clearDelayMs = 2600) {
  const [operation, setOperation] = useState<OptimisticOperation | null>(null);

  const reportOperation = useCallback((label: string, state: OptimisticOperationState) => {
    setOperation({ label, state });
    if (state !== "syncing") {
      window.setTimeout(() => {
        setOperation((current) => current?.label === label && current.state === state ? null : current);
      }, clearDelayMs);
    }
  }, [clearDelayMs]);

  const clearOperation = useCallback(() => setOperation(null), []);

  return { operation, reportOperation, clearOperation };
}

interface UseOptimisticOperationOptions {
  setBusy?: (busy: boolean) => void;
  clearErrors?: () => void;
  onRollback?: () => void;
  onRefresh?: () => void;
  onError?: (message?: string) => void;
  reportBackgroundOperation?: BackgroundOperationReporter;
}

interface RunOptimisticOperationOptions {
  background?: boolean;
  release?: () => void;
  beforeStart?: () => void;
  onSuccess?: () => void;
  onFailure?: () => void;
}

export function useOptimisticOperation({
  setBusy,
  clearErrors,
  onRollback,
  onRefresh,
  onError,
  reportBackgroundOperation,
}: UseOptimisticOperationOptions = {}) {
  const [pendingLabel, setPendingLabel] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setPendingIfMounted = useCallback((label: string) => {
    if (mountedRef.current) setPendingLabel(label);
  }, []);

  const setBusyIfMounted = useCallback((busy: boolean) => {
    if (mountedRef.current) setBusy?.(busy);
  }, [setBusy]);

  const runOptimisticOperation = useCallback(async (
    label: string,
    action: () => Promise<OptimisticOperationResult | void>,
    options: RunOptimisticOperationOptions = {},
  ) => {
    setBusyIfMounted(true);
    clearErrors?.();
    setPendingIfMounted(label);
    options.beforeStart?.();

    const handleFailure = (message?: string) => {
      onRollback?.();
      options.onFailure?.();
      if (options.background) reportBackgroundOperation?.(label, "failed");
      else onError?.(message);
    };

    const handleSuccess = () => {
      onRefresh?.();
      options.onSuccess?.();
      if (options.background) reportBackgroundOperation?.(label, "done");
    };

    if (options.background) {
      reportBackgroundOperation?.(label, "syncing");
      options.release?.();
      void action().then((result) => {
        if (result && result.success === false) {
          handleFailure(result.error);
          return;
        }
        handleSuccess();
      }).catch((err) => {
        console.error("Optimistic background operation failed:", err);
        handleFailure(err instanceof Error ? err.message : undefined);
      }).finally(() => {
        setBusyIfMounted(false);
        setPendingIfMounted("");
      });
      return;
    }

    try {
      const result = await action();
      if (result && result.success === false) {
        handleFailure(result.error);
        return;
      }
      handleSuccess();
    } catch (err) {
      handleFailure(err instanceof Error ? err.message : undefined);
    } finally {
      setBusyIfMounted(false);
      setPendingIfMounted("");
    }
  }, [
    clearErrors,
    onError,
    onRefresh,
    onRollback,
    reportBackgroundOperation,
    setBusyIfMounted,
    setPendingIfMounted,
  ]);

  const clearPendingLabel = useCallback(() => setPendingIfMounted(""), [setPendingIfMounted]);

  return { pendingLabel, clearPendingLabel, runOptimisticOperation };
}
