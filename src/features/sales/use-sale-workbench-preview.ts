"use client";

import { useCallback, useEffect, useState } from "react";
import {
  decodeWorkspace,
  workspaceQueryKey,
  type WorkspaceData,
  type WorkspaceQuery,
} from "@/features/contracts/workspace-model";

/** A bounded detail read independent of mutation forms and their request IDs. */
export function useSaleWorkbenchPreview(
  query: WorkspaceQuery | undefined,
  contractId: string | null,
  version: unknown,
) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    version: unknown;
    data: WorkspaceData | null;
    error: boolean;
  } | null>(null);
  const key = query && contractId ? `${workspaceQueryKey(query)}/${contractId}/${revision}` : null;
  useEffect(() => {
    if (!query || !contractId || !key) return;
    const abort = new AbortController();
    let active = true;
    setResult(null);
    const params = new URLSearchParams(
      Object.entries(query).map(([name, value]) => [name, String(value)]),
    );
    params.set("mode", "detail");
    params.set("contractId", contractId);
    void fetch(`/api/contracts/sale?${params}`, { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("SalePreviewUnavailable");
        return decodeWorkspace(await response.json(), "sale", query, "detail", contractId);
      })
      .then((data) => {
        if (active) setResult({ key, version, data, error: false });
      })
      .catch(() => {
        if (active) setResult({ key, version, data: null, error: true });
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [query, contractId, key, version]);
  const current = key && result?.key === key && result.version === version ? result : null;
  return {
    data: current?.data ?? null,
    loading: Boolean(key && !current),
    error: current?.error ?? false,
    retry: useCallback(() => setRevision((value) => value + 1), []),
  };
}
