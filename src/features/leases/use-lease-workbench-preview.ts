"use client";

import { useEffect, useState, useCallback } from "react";
import {
  decodeWorkspace,
  workspaceQueryKey,
  type WorkspaceData,
  type WorkspaceQuery,
} from "@/features/contracts/workspace-model";

/** A selected-row read, independent of list loading and all mutation state. */
export function useLeaseWorkbenchPreview(
  query: WorkspaceQuery | undefined,
  contractId: string | null,
  selectionVersion = 0,
) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: WorkspaceData | null;
    error: boolean;
  } | null>(null);
  const key =
    query && contractId
      ? `${workspaceQueryKey(query)}/${contractId}/${selectionVersion}/${revision}`
      : null;

  useEffect(() => {
    if (!query || !contractId || !key) return;
    const controller = new AbortController();
    let active = true;
    const params = new URLSearchParams(
      Object.entries(query).map(([name, value]) => [name, String(value)]),
    );
    params.set("mode", "detail");
    params.set("contractId", contractId);
    void fetch(`/api/contracts/lease?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("LeasePreviewUnavailable");
        return decodeWorkspace(await response.json(), "lease", query, "detail", contractId);
      })
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
  }, [query, contractId, key]);

  const current = key && result?.key === key ? result : null;
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  return {
    data: current?.data ?? null,
    loading: Boolean(key && !current),
    error: current?.error ?? false,
    retry,
  };
}
