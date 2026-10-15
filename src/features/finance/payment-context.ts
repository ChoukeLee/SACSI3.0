export interface PaymentContext {
  paymentId: string;
  unitId?: string | null;
  buildingId?: string | null;
  paymentDate: string;
  amount: number;
  currency: string;
  recordedBy: string | null;
  recordedByName: string | null;
  actualCollector: string | null;
  collectorBasis: string | null;
  version: number;
  token: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  allocatedXof: number;
  allocations: {
    receivableId: string;
    title: string;
    dueDate: string;
    allocatedXof: number;
    periodStart: string | null;
    periodEnd: string | null;
    periodSource: string | null;
    token: string;
  }[];
}
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const token = /^[0-9a-f]{32}$/;
export function validPaymentContextId(value: string) {
  return uuid.test(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalidPaymentContext");
  return value as Record<string, unknown>;
}
function string(value: unknown, limit: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit)
    throw new Error("invalidPaymentContext");
  return value.trim();
}
function date(value: unknown) {
  const result = string(value, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(Date.parse(`${result}T00:00:00Z`)) ||
    new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result
  )
    throw new Error("invalidPaymentContext");
  return result;
}
export function parsePaymentContextConfirmation(value: unknown) {
  const body = record(value);
  if (Object.keys(body).some((key) => !["requestId", "input"].includes(key)))
    throw new Error("invalidPaymentContext");
  const requestId = string(body.requestId, 36);
  if (!uuid.test(requestId)) throw new Error("invalidPaymentContext");
  const raw = record(body.input);
  if (
    Object.keys(raw).some(
      (key) => !["expectedToken", "collectorName", "collectorBasis", "periods"].includes(key),
    )
  )
    throw new Error("invalidPaymentContext");
  const expectedToken = string(raw.expectedToken, 32);
  if (!token.test(expectedToken)) throw new Error("invalidPaymentContext");
  if (raw.periods !== undefined && !Array.isArray(raw.periods))
    throw new Error("invalidPaymentContext");
  const periods = ((raw.periods as unknown[] | undefined) ?? []).map((value) => {
    const row = record(value);
    if (
      Object.keys(row).some(
        (key) => !["receivableId", "expectedToken", "start", "end", "source"].includes(key),
      )
    )
      throw new Error("invalidPaymentContext");
    const receivableId = string(row.receivableId, 36),
      expectedToken = string(row.expectedToken, 32);
    const start = date(row.start),
      end = date(row.end),
      source = string(row.source, 1000);
    if (!uuid.test(receivableId) || !token.test(expectedToken) || end < start)
      throw new Error("invalidPaymentContext");
    return { receivableId, expectedToken, start, end, source };
  });
  if (
    periods.length > 100 ||
    new Set(periods.map((row) => row.receivableId)).size !== periods.length
  )
    throw new Error("invalidPaymentContext");
  const collector =
    raw.collectorName === undefined
      ? {}
      : {
          collectorName: string(raw.collectorName, 100),
          collectorBasis: string(raw.collectorBasis, 1000),
        };
  if (!Object.keys(collector).length && (raw.collectorBasis !== undefined || !periods.length))
    throw new Error("invalidPaymentContext");
  return { requestId, input: { expectedToken, ...collector, periods } };
}

export function decodePaymentContext(value: unknown): PaymentContext {
  const row = record(value);
  if (
    !validPaymentContextId(String(row.paymentId)) ||
    !token.test(String(row.token)) ||
    !Array.isArray(row.allocations)
  )
    throw new Error("paymentContextUnavailable");
  const numeric = (value: unknown) => {
    const result = Number(value);
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value)) ||
      !Number.isFinite(result) ||
      Math.abs(result) > Number.MAX_SAFE_INTEGER / 100
    )
      throw new Error("paymentContextUnavailable");
    return result;
  };
  const nullable = (value: unknown) => {
    if (value !== null && typeof value !== "string") throw new Error("paymentContextUnavailable");
    return value as string | null;
  };
  const version = numeric(row.version);
  if (!Number.isSafeInteger(version) || version < 0) throw new Error("paymentContextUnavailable");
  return {
    paymentId: String(row.paymentId),
    unitId: row.unitId === undefined ? null : nullable(row.unitId),
    buildingId: row.buildingId === undefined ? null : nullable(row.buildingId),
    paymentDate: date(row.paymentDate),
    amount: numeric(row.amount),
    currency: string(row.currency, 10),
    recordedBy: nullable(row.recordedBy),
    recordedByName: nullable(row.recordedByName),
    actualCollector: nullable(row.actualCollector),
    collectorBasis: nullable(row.collectorBasis),
    version,
    token: String(row.token),
    confirmedBy: nullable(row.confirmedBy),
    confirmedAt: nullable(row.confirmedAt),
    allocatedXof: numeric(row.allocatedXof),
    allocations: row.allocations.map((value) => {
      const item = record(value);
      if (!uuid.test(String(item.receivableId)) || !token.test(String(item.token)))
        throw new Error("paymentContextUnavailable");
      return {
        receivableId: String(item.receivableId),
        title: string(item.title, 1000),
        dueDate: date(item.dueDate),
        allocatedXof: numeric(item.allocatedXof),
        periodStart: item.periodStart === null ? null : date(item.periodStart),
        periodEnd: item.periodEnd === null ? null : date(item.periodEnd),
        periodSource: nullable(item.periodSource),
        token: String(item.token),
      };
    }),
  };
}
