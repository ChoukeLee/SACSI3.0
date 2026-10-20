export const OPERATOR_INBOX_KINDS = [
  "confirmations",
  "collections",
  "daily-workflows",
  "booking-operations",
] as const;
export const OPERATOR_INBOX_STATES = [
  "pending",
  "completed",
  "expired",
  "superseded",
  "unknown",
] as const;
export type OperatorInboxKind = (typeof OPERATOR_INBOX_KINDS)[number];
export type OperatorInboxState = (typeof OPERATOR_INBOX_STATES)[number];
export interface OperatorInboxQuery {
  state: "all" | OperatorInboxState;
  kind: "all" | OperatorInboxKind;
  search: string;
  dateFrom: string;
  dateTo: string;
  page: number;
}
export interface OperatorInboxItem {
  id: string;
  requestId: string;
  kind: OperatorInboxKind;
  sourceStatus: string;
  state: OperatorInboxState;
  createdAt: string;
  expiresAt: string;
  unitNo: string | null;
  buildingLabel: string | null;
  operation: string | null;
  itemCount: number | null;
}
export interface OperatorInboxResult {
  page: number;
  pageSize: 30;
  total: number;
  counts: Record<"all" | OperatorInboxState, number>;
  items: OperatorInboxItem[];
}
export class OperatorInboxQueryError extends Error {
  constructor() {
    super("InvalidOperatorInboxQuery");
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function realDate(value: string) {
  return (
    /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function parseOperatorInboxQuery(
  params: Record<string, string | string[] | undefined>,
): OperatorInboxQuery {
  const one = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) throw new OperatorInboxQueryError();
    return value?.trim() ?? "";
  };
  if (
    Object.keys(params).some(
      (key) => !["state", "kind", "search", "dateFrom", "dateTo", "page"].includes(key),
    )
  )
    throw new OperatorInboxQueryError();
  const state = one("state") || "all",
    kind = one("kind") || "all",
    search = one("search");
  const dateFrom = one("dateFrom"),
    dateTo = one("dateTo"),
    pageText = one("page") || "1";
  if (
    (state !== "all" && !OPERATOR_INBOX_STATES.includes(state as OperatorInboxState)) ||
    (kind !== "all" && !OPERATOR_INBOX_KINDS.includes(kind as OperatorInboxKind)) ||
    (search && !/^[a-f0-9-]{1,36}$/i.test(search)) ||
    (dateFrom && !realDate(dateFrom)) ||
    (dateTo && !realDate(dateTo)) ||
    (dateFrom && dateTo && dateFrom > dateTo) ||
    !/^\d+$/.test(pageText) ||
    Number(pageText) < 1 ||
    Number(pageText) > 2000000
  )
    throw new OperatorInboxQueryError();
  return {
    state: state as OperatorInboxQuery["state"],
    kind: kind as OperatorInboxQuery["kind"],
    search: search.toLowerCase(),
    dateFrom,
    dateTo,
    page: Number(pageText),
  };
}
export function operatorInboxFilters(query: OperatorInboxQuery) {
  const { page: _page, ...filters } = query;
  void _page;
  return filters;
}
export function operatorInboxHref(
  query: OperatorInboxQuery,
  locale: "zh" | "fr",
  patch: Partial<OperatorInboxQuery> = {},
) {
  const value = { ...query, ...patch },
    params = new URLSearchParams();
  for (const key of ["state", "kind", "search", "dateFrom", "dateTo"] as const)
    if (value[key] && value[key] !== "all") params.set(key, value[key]);
  if (value.page !== 1) params.set("page", String(value.page));
  return `${locale === "fr" ? "/fr" : ""}/operator${params.size ? `?${params}` : ""}`;
}
export function operatorInboxItemHref(item: OperatorInboxItem, locale: "zh" | "fr") {
  return item.state === "unknown"
    ? null
    : `${locale === "fr" ? "/fr" : ""}/operator/${item.kind}/${item.id}`;
}
export function decodeOperatorInboxResult(
  raw: unknown,
  query: OperatorInboxQuery,
): OperatorInboxResult {
  const invalid = () => {
    throw new Error("OperatorInboxReadUnavailable");
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const value = raw as Record<string, unknown>,
    counts = value.counts as Record<string, unknown>;
  if (
    value.page !== query.page ||
    value.pageSize !== 30 ||
    !Number.isSafeInteger(value.total) ||
    Number(value.total) < 0 ||
    !counts ||
    typeof counts !== "object" ||
    Array.isArray(counts) ||
    !Array.isArray(value.items) ||
    value.items.length > 30
  )
    return invalid();
  for (const key of ["all", ...OPERATOR_INBOX_STATES])
    if (!Number.isSafeInteger(counts[key]) || Number(counts[key]) < 0) return invalid();
  if (
    OPERATOR_INBOX_STATES.reduce((sum, key) => sum + Number(counts[key]), 0) !== counts.all ||
    value.total !== counts[query.state]
  )
    return invalid();
  const ids = new Set<string>();
  const items = value.items.map((data): OperatorInboxItem => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return invalid();
    const row = data as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      !uuid.test(row.id) ||
      typeof row.requestId !== "string" ||
      !uuid.test(row.requestId) ||
      !OPERATOR_INBOX_KINDS.includes(row.kind as OperatorInboxKind) ||
      !OPERATOR_INBOX_STATES.includes(row.state as OperatorInboxState) ||
      typeof row.sourceStatus !== "string" ||
      !row.sourceStatus ||
      row.sourceStatus.length > 100 ||
      typeof row.createdAt !== "string" ||
      !Number.isFinite(Date.parse(row.createdAt)) ||
      typeof row.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(row.expiresAt)) ||
      (query.kind !== "all" && row.kind !== query.kind) ||
      (query.state !== "all" && row.state !== query.state)
    )
      return invalid();
    const state =
      row.sourceStatus === "completed"
        ? "completed"
        : row.sourceStatus === "superseded"
          ? "superseded"
          : row.sourceStatus === "pending"
            ? row.state
            : "unknown";
    if (
      state !== row.state ||
      (row.sourceStatus === "pending" && !["pending", "expired"].includes(row.state as string))
    )
      return invalid();
    for (const key of ["unitNo", "buildingLabel", "operation"] as const)
      if (row[key] !== null && typeof row[key] !== "string") return invalid();
    if (
      row.itemCount !== null &&
      (!Number.isSafeInteger(row.itemCount) || Number(row.itemCount) < 0)
    )
      return invalid();
    const identity = `${row.kind}:${row.id}`;
    if (ids.has(identity)) return invalid();
    ids.add(identity);
    return row as unknown as OperatorInboxItem;
  });
  const expected = Math.min(30, Math.max(0, Number(value.total) - (query.page - 1) * 30));
  if (items.length !== expected) return invalid();
  return {
    page: query.page,
    pageSize: 30,
    total: Number(value.total),
    counts: counts as OperatorInboxResult["counts"],
    items,
  };
}
