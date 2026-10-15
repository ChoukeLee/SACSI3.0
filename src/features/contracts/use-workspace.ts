"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeWorkspace,
  workspaceQueryKey,
  WorkspaceReadError,
  type WorkspaceData,
  type WorkspaceMode,
  type WorkspaceQuery,
} from "./workspace-model";
const merge = <T extends { id: string }>(...lists: (T[] | undefined)[]) => [
  ...new Map(lists.flatMap((rows) => rows ?? []).map((row) => [row.id, row])).values(),
];
export function useContractWorkspace(initial: WorkspaceData | undefined) {
  const [pageData, setPageData] = useState(initial),
    [scopeData, setScopeData] = useState<WorkspaceData>(),
    [detailData, setDetailData] = useState<WorkspaceData>(),
    [contextData, setContextData] = useState<WorkspaceData>();
  const [query, setQuery] = useState(initial?.query),
    [loading, setLoading] = useState(false),
    [specialLoading, setSpecialLoading] = useState(false),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const initialRef = useRef(initial),
    seenInitial = useRef(initial),
    activeScope = useRef<{ insight: boolean } | null>(null);
  const initialConsumed = useRef(false),
    scopeGeneration = useRef(0),
    detailId = useRef<string | undefined>(undefined),
    specialRequest = useRef(0);
  const read = useCallback(
    async (q: WorkspaceQuery, mode: WorkspaceMode = "list", id?: string, signal?: AbortSignal) => {
      if (!initial) throw new WorkspaceReadError();
      const search = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]));
      search.set("mode", mode);
      if (id) search.set("contractId", id);
      const response = await fetch(`/api/contracts/${initial.kind}?${search}`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new WorkspaceReadError(response.status);
      return decodeWorkspace(await response.json(), initial.kind, q, mode, id);
    },
    [initial?.kind],
  );
  useEffect(() => {
    const first = initialRef.current;
    if (!first || !query) return;
    const key = workspaceQueryKey(query);
    if (!initialConsumed.current && revision === 0 && key === workspaceQueryKey(first.query)) {
      initialConsumed.current = true;
      return;
    }
    initialConsumed.current = true;
    const controller = new AbortController();
    let active = true;
    const generation = ++scopeGeneration.current;
    specialRequest.current++;
    setLoading(true);
    setSpecialLoading(false);
    setError(false);
    setScopeData(undefined);
    setContextData(undefined);
    setDetailData(undefined);
    detailId.current = undefined;
    const scopeQuery = { ...query };
    if (activeScope.current?.insight) {
      scopeQuery.search = "";
      scopeQuery.status = first.kind === "lease" ? "all" : scopeQuery.status;
      scopeQuery.page = 1;
    }
    const request = () =>
      Promise.all([
        read(query, "list", undefined, controller.signal),
        activeScope.current
          ? read(scopeQuery, "scope", undefined, controller.signal)
          : Promise.resolve(undefined),
      ])
        .then(([data, scope]) => {
          if (active && generation === scopeGeneration.current) {
            const last = Math.max(1, Math.ceil(data.total / 25));
            if (query.page > last) {
              setQuery({ ...query, page: last });
              return;
            }
            setPageData(data);
            setScopeData(scope);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active && generation === scopeGeneration.current) {
            setError(true);
            setLoading(false);
          }
        });
    const delay = pageData && query.search !== pageData.query.search ? 200 : 0;
    const timer = setTimeout(request, delay);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, revision, read]);
  const ensure = useCallback(
    async (mode: WorkspaceMode, id?: string, insight = false) => {
      if (!queryRef.current || loading || error) throw new WorkspaceReadError();
      const q = { ...queryRef.current };
      if (mode === "scope" && insight) {
        q.search = "";
        q.status = initial?.kind === "lease" ? "all" : q.status;
        q.page = 1;
      }
      const generation = scopeGeneration.current,
        request = ++specialRequest.current;
      setSpecialLoading(true);
      if (mode === "detail") {
        setDetailData(undefined);
        detailId.current = id;
      } else {
        detailId.current = undefined;
        setDetailData(undefined);
      }
      if (mode === "scope") activeScope.current = { insight };
      try {
        const data = await read(q, mode, id);
        if (generation !== scopeGeneration.current || request !== specialRequest.current)
          throw new WorkspaceReadError();
        if (mode === "detail") setDetailData(data);
        else if (mode === "scope") setScopeData(data);
        else if (mode === "context") setContextData(data);
        return data;
      } catch (e) {
        if (generation === scopeGeneration.current && request === specialRequest.current)
          setError(true);
        throw e;
      } finally {
        if (request === specialRequest.current) setSpecialLoading(false);
      }
    },
    [read, loading, error, initial?.kind],
  );
  const refresh = useCallback(async () => {
    const q = queryRef.current;
    if (!q) return;
    const id = detailId.current;
    const generation = ++scopeGeneration.current;
    ++specialRequest.current;
    setLoading(true);
    setSpecialLoading(false);
    setError(false);
    setScopeData(undefined);
    setContextData(undefined);
    setDetailData(undefined);
    const scopeQuery = { ...q };
    if (activeScope.current?.insight) {
      scopeQuery.search = "";
      scopeQuery.status = initial?.kind === "lease" ? "all" : scopeQuery.status;
      scopeQuery.page = 1;
    }
    try {
      const [page, detail, scope] = await Promise.all([
        read(q),
        id ? read(q, "detail", id) : Promise.resolve(undefined),
        activeScope.current ? read(scopeQuery, "scope") : Promise.resolve(undefined),
      ]);
      if (generation !== scopeGeneration.current) return false;
      const last = Math.max(1, Math.ceil(page.total / 25));
      if (q.page > last) {
        setQuery({ ...q, page: last });
        return true;
      }
      setPageData(page);
      setDetailData(detail);
      setScopeData(scope);
      setLoading(false);
      return true;
    } catch {
      if (generation === scopeGeneration.current) {
        setError(true);
        setLoading(false);
      }
      return false;
    }
  }, [read]);
  useEffect(() => {
    if (!initial || seenInitial.current === initial) return;
    const previous = seenInitial.current;
    seenInitial.current = initial;
    initialRef.current = initial;
    const navigation =
      !previous ||
      previous.kind !== initial.kind ||
      workspaceQueryKey(previous.query) !== workspaceQueryKey(initial.query);
    if (navigation) {
      scopeGeneration.current++;
      specialRequest.current++;
      activeScope.current = null;
      detailId.current = undefined;
      initialConsumed.current = false;
      setQuery(initial.query);
      setPageData(initial);
      setScopeData(undefined);
      setDetailData(undefined);
      setContextData(undefined);
      setSpecialLoading(false);
      setLoading(false);
      setError(false);
      setRevision(0);
    } else void refresh();
  }, [initial, refresh]);
  const merged = useMemo(
    () =>
      initial && pageData
        ? {
            ...pageData,
            contracts: merge(
              pageData.contracts,
              scopeData?.contracts,
              contextData?.contracts,
              detailData?.contracts,
            ),
            units: merge(pageData.units, scopeData?.units, contextData?.units, detailData?.units),
            customers: merge(
              pageData.customers,
              scopeData?.customers,
              contextData?.customers,
              detailData?.customers,
            ),
            payments: detailData?.payments ?? [],
            receivables: detailData?.receivables ?? [],
            schedules: detailData?.schedules ?? [],
            summaries: {
              ...pageData.summaries,
              ...scopeData?.summaries,
              ...contextData?.summaries,
              ...detailData?.summaries,
            },
            accruals: { ...pageData.accruals, ...scopeData?.accruals, ...detailData?.accruals },
            attentionDue: {
              ...pageData.attentionDue,
              ...scopeData?.attentionDue,
              ...detailData?.attentionDue,
            },
          }
        : undefined,
    [initial, pageData, scopeData, contextData, detailData],
  );
  const change = useCallback(
    (patch: Partial<WorkspaceQuery>) =>
      setQuery((current) => {
        if (!current) return current;
        const next = { ...current, ...patch };
        return workspaceQueryKey(current) === workspaceQueryKey(next) ? current : next;
      }),
    [],
  );
  const closeScope = useCallback(() => {
    activeScope.current = null;
    setScopeData(undefined);
  }, []);
  return {
    enabled: Boolean(initial),
    data: merged,
    pageData,
    scopeData,
    detailData,
    query,
    change,
    ensure,
    refresh,
    closeScope,
    retry: () => setRevision((v) => v + 1),
    loading: loading || specialLoading,
    error,
    unavailable:
      Boolean(initial) &&
      (seenInitial.current !== initial ||
        loading ||
        specialLoading ||
        error ||
        !pageData ||
        Boolean(query && workspaceQueryKey(query) !== workspaceQueryKey(pageData.query))),
    pagination:
      initial && query && pageData
        ? {
            page: query.page,
            total: pageData.total,
            pageSize: 25,
            sort: { key: query.sort, direction: query.direction },
            onPageChange: (page: number) => change({ page }),
            onSortChange: (sort: WorkspaceQuery["sort"], direction: WorkspaceQuery["direction"]) =>
              change({ sort, direction, page: 1 }),
          }
        : undefined,
  };
}
