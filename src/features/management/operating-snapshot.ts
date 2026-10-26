import { decodeNativeSummary, type NativeCurrencySummary } from "@/lib/native-money";
/** The dashboard read model is separate from receivable allocation metrics. */
export interface OperatingSnapshot {
  nativeSummary?: NativeCurrencySummary[];
  projectId: string;
  asOf: string;
  monthStart: string;
  generatedAt: string;
  netCollected: number;
  excludedCount: number;
  dueOutstanding: number;
  overdue: number;
  upcoming: number;
  historicalPending: number;
  attentionCount: number;
  assetCount: number;
  assetAttention: number;
  leaseCount: number;
  pendingLeaseCount?: number;
  renewalCount: number;
  saleCount: number;
  saleAttention: number;
  dailyInHouse: number;
  dailyNet: number;
  businessNet: { lease: number; sale: number; asset: number };
  trend: { month: string; net: number; excluded: number; count: number }[];
  dueItems: {
    id: string;
    date: string;
    title: string;
    unit: string | null;
    building: string | null;
    balance: number;
    sourceType: string;
  }[];
  renewals: { id: string; unit: string | null; date: string }[];
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("OperatingSnapshotUnavailable");
  return value as Record<string, unknown>;
};
const numeric = (value: unknown) => {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    value === "" ||
    !Number.isFinite(Number(value)) ||
    Math.abs(Number(value)) > Number.MAX_SAFE_INTEGER
  )
    throw new Error("OperatingSnapshotUnavailable");
  return Number(value);
};
const text = (value: unknown) => {
  if (typeof value !== "string") throw new Error("OperatingSnapshotUnavailable");
  return value;
};
const nullable = (value: unknown) => (value === null ? null : text(value));
const date = (value: unknown) => {
  const result = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result
  )
    throw new Error("OperatingSnapshotUnavailable");
  return result;
};
export function decodeOperatingSnapshot(value: unknown): OperatingSnapshot {
  const raw = object(value);
  const amounts = [
    "netCollected",
    "excludedCount",
    "dueOutstanding",
    "overdue",
    "upcoming",
    "historicalPending",
    "attentionCount",
    "assetCount",
    "assetAttention",
    "leaseCount",
    "renewalCount",
    "saleCount",
    "saleAttention",
    "dailyInHouse",
    "dailyNet",
  ] as const;
  const result = Object.fromEntries(amounts.map((key) => [key, numeric(raw[key])])) as Pick<
    OperatingSnapshot,
    (typeof amounts)[number]
  >;
  const pendingLeaseCount =
    raw.pendingLeaseCount === undefined ? undefined : numeric(raw.pendingLeaseCount);
  if (
    pendingLeaseCount !== undefined &&
    (!Number.isSafeInteger(pendingLeaseCount) || pendingLeaseCount < 0)
  )
    throw new Error("OperatingSnapshotUnavailable");
  for (const key of amounts.filter((key) => !["netCollected", "dailyNet"].includes(key))) {
    if (result[key] < 0) throw new Error("OperatingSnapshotUnavailable");
  }
  const business = object(raw.businessNet);
  if (
    !Array.isArray(raw.trend) ||
    raw.trend.length !== 12 ||
    !Array.isArray(raw.dueItems) ||
    !Array.isArray(raw.renewals)
  )
    throw new Error("OperatingSnapshotUnavailable");
  const asOf = date(raw.asOf),
    monthStart = date(raw.monthStart);
  if (
    monthStart !== `${asOf.slice(0, 7)}-01` ||
    !Number.isFinite(Date.parse(text(raw.generatedAt)))
  )
    throw new Error("OperatingSnapshotUnavailable");
  for (const key of [
    "excludedCount",
    "historicalPending",
    "attentionCount",
    "assetCount",
    "assetAttention",
    "leaseCount",
    "renewalCount",
    "saleCount",
    "saleAttention",
    "dailyInHouse",
  ] as const) {
    if (!Number.isSafeInteger(result[key])) throw new Error("OperatingSnapshotUnavailable");
  }
  const expectedMonths = Array.from({ length: 12 }, (_, index) =>
    new Date(Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 12 + index, 1))
      .toISOString()
      .slice(0, 7),
  );
  return {
    ...result,
    ...(pendingLeaseCount !== undefined ? { pendingLeaseCount } : {}),
    ...(raw.nativeSummary !== undefined
      ? { nativeSummary: decodeNativeSummary(raw.nativeSummary) }
      : {}),
    projectId: text(raw.projectId),
    asOf,
    monthStart,
    generatedAt: text(raw.generatedAt),
    businessNet: {
      lease: numeric(business.lease),
      sale: numeric(business.sale),
      asset: numeric(business.asset),
    },
    trend: raw.trend.map((item, index) => {
      const row = object(item),
        month = text(row.month);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("OperatingSnapshotUnavailable");
      const net = numeric(row.net),
        excluded = numeric(row.excluded),
        count = numeric(row.count);
      if (
        month !== expectedMonths[index] ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        !Number.isSafeInteger(excluded) ||
        excluded < 0 ||
        (count === 0 && net !== 0) ||
        (index === 11 && net !== result.netCollected)
      )
        throw new Error("OperatingSnapshotUnavailable");
      return { month, net, excluded, count };
    }),
    dueItems: raw.dueItems.map((item) => {
      const row = object(item);
      return {
        id: text(row.id),
        date: date(row.date),
        title: text(row.title),
        unit: nullable(row.unit),
        building: nullable(row.building),
        balance: numeric(row.balance),
        sourceType: text(row.sourceType),
      };
    }),
    renewals: raw.renewals.map((item) => {
      const row = object(item);
      return { id: text(row.id), unit: nullable(row.unit), date: date(row.date) };
    }),
  };
}
