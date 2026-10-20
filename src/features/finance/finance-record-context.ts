import type { FinanceKind } from "./finance-read";

export interface FinanceRecordContext {
  kind: FinanceKind;
  id: string;
  amountXof: number;
  nativeAmount?: number;
  nativePaidAmount?: number;
  currency?: string;
  date: string;
  category: string;
  direction: "income" | "expense" | "liability_in" | "liability_out" | null;
  title: string | null;
  paidAmountXof: number | null;
  status: string | null;
  managementStatus: string | null;
  paymentId: string | null;
  paymentMethod: string | null;
  building: { id: string; label: string; projectId: string | null } | null;
  unit: { id: string; label: string } | null;
  customer: { id: string; label: string } | null;
  source: {
    type: string;
    id: string | null;
    label: string | null;
    href: string | null;
    linkKind: "workspace" | null;
  } | null;
  period: { start: string | null; end: string | null; source: string | null } | null;
}

export const financeRecordContextUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const unavailable = () => new Error("financeRecordContextUnavailable");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw unavailable();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 36);
  if (!financeRecordContextUuid.test(result)) throw unavailable();
  return result;
}
function date(value: unknown): string {
  const result = text(value, 10);
  const stamp = Date.parse(`${result}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(stamp) ||
    new Date(stamp).toISOString().slice(0, 10) !== result
  )
    throw unavailable();
  return result;
}
function number(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER / 100
  )
    throw unavailable();
  return value;
}
const nullable = <T>(value: unknown, decode: (value: unknown) => T): T | null =>
  value === null ? null : decode(value);

export function parseFinanceRecordContextQuery(params: URLSearchParams): {
  kind: FinanceKind;
  id: string;
} {
  if (
    [...params.keys()].some(
      (key) => !["kind", "id"].includes(key) || params.getAll(key).length !== 1,
    )
  )
    throw new Error("invalidFinanceRecordContext");
  const kind = params.get("kind");
  const target = params.get("id");
  if (
    (kind !== "ledger" && kind !== "receivables") ||
    !target ||
    !financeRecordContextUuid.test(target)
  )
    throw new Error("invalidFinanceRecordContext");
  return { kind, id: target };
}

/** Decode the API boundary without interpreting unknown facts as zero or empty success. */
export function decodeFinanceRecordContext(value: unknown): FinanceRecordContext {
  const row = object(value);
  if (row.kind !== "ledger" && row.kind !== "receivables") throw unavailable();
  const direction = nullable(row.direction, (value) => {
    if (
      typeof value !== "string" ||
      !["income", "expense", "liability_in", "liability_out"].includes(value)
    )
      throw unavailable();
    return value as NonNullable<FinanceRecordContext["direction"]>;
  });
  if ((row.kind === "ledger") !== (direction !== null)) throw unavailable();
  const label = (value: unknown) => {
    const item = object(value);
    return { id: id(item.id), label: text(item.label) };
  };
  const result: FinanceRecordContext = {
    kind: row.kind,
    id: id(row.id),
    amountXof: number(row.amountXof),
    ...(row.nativeAmount !== undefined
      ? {
          nativeAmount: number(row.nativeAmount),
          currency: text(row.currency, 3),
          ...(row.nativePaidAmount !== undefined
            ? { nativePaidAmount: number(row.nativePaidAmount) }
            : {}),
        }
      : {}),
    date: date(row.date),
    category: text(row.category, 100),
    direction,
    title: nullable(row.title, text),
    paidAmountXof: nullable(row.paidAmountXof, number),
    status: nullable(row.status, (value) => text(value, 100)),
    managementStatus: nullable(row.managementStatus, (value) => text(value, 100)),
    paymentId: nullable(row.paymentId, id),
    paymentMethod: nullable(row.paymentMethod, (value) => text(value, 100)),
    building: nullable(row.building, (value) => {
      const item = object(value);
      return { ...label(item), projectId: nullable(item.projectId, id) };
    }),
    unit: nullable(row.unit, label),
    customer: nullable(row.customer, label),
    source: nullable(row.source, (value) => {
      const item = object(value);
      const href = nullable(item.href, (value) => text(value, 150));
      const linkKind = item.linkKind;
      if (linkKind !== null && linkKind !== "workspace") throw unavailable();
      if ((href === null) !== (linkKind === null)) throw unavailable();
      // There is no supported direct-record deep link. Only fixed workspace routes are allowed.
      if (href && !/^\/(?:leases|sales)\?project=[0-9a-f-]{36}$/i.test(href)) throw unavailable();
      return {
        type: text(item.type, 100),
        id: nullable(item.id, id),
        label: nullable(item.label, text),
        href,
        linkKind,
      };
    }),
    period: nullable(row.period, (value) => {
      const item = object(value);
      const start = nullable(item.start, date),
        end = nullable(item.end, date);
      const source = nullable(item.source, (value) => text(value, 1000));
      if (!end || !source || (start && start > end)) throw unavailable();
      return { start, end, source };
    }),
  };
  if (
    result.kind === "ledger" &&
    (result.paidAmountXof !== null ||
      result.period !== null ||
      result.status !== null ||
      result.managementStatus !== null)
  )
    throw unavailable();
  if (
    result.kind === "receivables" &&
    (result.paymentId !== null ||
      result.paymentMethod !== null ||
      result.paidAmountXof === null ||
      !["pending", "partial", "paid", "overdue", "cancelled"].includes(result.status ?? ""))
  )
    throw unavailable();
  if (
    result.managementStatus !== null &&
    !["managed", "historical_pending", "excluded"].includes(result.managementStatus)
  )
    throw unavailable();
  if (
    result.paymentMethod !== null &&
    !["cash", "check", "bank_transfer", "offset", "other"].includes(result.paymentMethod)
  )
    throw unavailable();
  if (result.source?.href) {
    const route =
      result.source.type === "lease_contract"
        ? "/leases"
        : result.source.type === "sale_contract"
          ? "/sales"
          : null;
    if (
      !route ||
      !result.source.id ||
      !result.building?.projectId ||
      result.source.href !== `${route}?project=${result.building.projectId}`
    )
      throw unavailable();
  }
  return result;
}
