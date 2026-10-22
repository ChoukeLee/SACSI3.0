import type { LeaseCollectionCoverage } from "@/features/leases/lease-collection-types";

export interface NativeCollectionRequest {
  protocolVersion: "1.0";
  connectorVersion: string;
  requestId: string;
  originalInstruction: string;
  inputSource: "natural_language" | "excel_screenshot";
  contractId: string;
  currency: "USD" | "CNY";
  /** Exact original-currency decimal, never an XOF amount or exchange rate. */
  amount: string;
  paymentDate: string;
  paymentMethod: "cash" | "check" | "bank_transfer" | "other";
  allocations: Array<{ receivableId: string; amount: string }>;
  externalReceiptNo?: string;
  actualCollector?: string;
  collectorBasis?: string;
  notes?: string;
  coverage?: LeaseCollectionCoverage;
}

export class NativeCollectionFailure extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const invalid = () => new NativeCollectionFailure("invalidNativeCollection");
export function nativeObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function nativeOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
export function nativeUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
export function nativeMoneyMinor(value: unknown, allowZero = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value)) throw invalid();
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if ((!allowZero && minor === BigInt(0)) || minor > BigInt("99999999999999")) throw invalid();
  return minor;
}
export function nativeMoney(value: unknown, allowZero = false): string {
  const minor = nativeMoneyMinor(value, allowZero);
  return `${minor / BigInt(100)}.${(minor % BigInt(100)).toString().padStart(2, "0")}`;
}
function date(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw invalid();
  return value.trim();
}
function id(value: unknown): string {
  if (!nativeUuid(value)) throw invalid();
  return value.toLowerCase();
}
function coverage(value: unknown): LeaseCollectionCoverage {
  if (
    !nativeObject(value) ||
    !nativeOnlyKeys(value, [
      "expectedPaidThroughDate",
      "expectedContractUpdatedAt",
      "throughDate",
      "receivableIds",
    ]) ||
    !date(value.expectedPaidThroughDate) ||
    !date(value.throughDate) ||
    value.throughDate <= value.expectedPaidThroughDate ||
    typeof value.expectedContractUpdatedAt !== "string" ||
    value.expectedContractUpdatedAt.length > 100 ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value.expectedContractUpdatedAt) ||
    !Number.isFinite(Date.parse(value.expectedContractUpdatedAt)) ||
    !Array.isArray(value.receivableIds) ||
    value.receivableIds.length < 1 ||
    value.receivableIds.length > 100
  )
    throw invalid();
  const receivableIds = value.receivableIds.map(id);
  if (new Set(receivableIds).size !== receivableIds.length) throw invalid();
  return {
    expectedPaidThroughDate: value.expectedPaidThroughDate,
    expectedContractUpdatedAt: value.expectedContractUpdatedAt,
    throughDate: value.throughDate,
    receivableIds,
  };
}

export function parseNativeCollection(
  value: unknown,
  today = new Date().toISOString().slice(0, 10),
): NativeCollectionRequest {
  if (
    !nativeObject(value) ||
    !nativeOnlyKeys(value, [
      "protocolVersion",
      "connectorVersion",
      "requestId",
      "originalInstruction",
      "inputSource",
      "contractId",
      "currency",
      "amount",
      "paymentDate",
      "paymentMethod",
      "allocations",
      "externalReceiptNo",
      "actualCollector",
      "collectorBasis",
      "notes",
      "coverage",
    ]) ||
    value.protocolVersion !== "1.0" ||
    value.connectorVersion !== "0.7.0" ||
    typeof value.inputSource !== "string" ||
    !["natural_language", "excel_screenshot"].includes(value.inputSource) ||
    typeof value.currency !== "string" ||
    !["USD", "CNY"].includes(value.currency) ||
    !date(value.paymentDate) ||
    value.paymentDate > today ||
    typeof value.paymentMethod !== "string" ||
    !["cash", "check", "bank_transfer", "other"].includes(value.paymentMethod) ||
    !Array.isArray(value.allocations) ||
    value.allocations.length < 1 ||
    value.allocations.length > 100
  )
    throw invalid();
  const allocations = value.allocations.map((raw) => {
    if (!nativeObject(raw) || !nativeOnlyKeys(raw, ["receivableId", "amount"])) throw invalid();
    return { receivableId: id(raw.receivableId), amount: nativeMoney(raw.amount) };
  });
  const amount = nativeMoney(value.amount);
  if (
    new Set(allocations.map((row) => row.receivableId)).size !== allocations.length ||
    allocations.reduce((sum, row) => sum + nativeMoneyMinor(row.amount), BigInt(0)) !==
      nativeMoneyMinor(amount)
  )
    throw invalid();
  const result: NativeCollectionRequest = {
    protocolVersion: "1.0",
    connectorVersion: value.connectorVersion,
    requestId: id(value.requestId),
    originalInstruction: text(value.originalInstruction, 4000),
    inputSource: value.inputSource as NativeCollectionRequest["inputSource"],
    contractId: id(value.contractId),
    currency: value.currency as NativeCollectionRequest["currency"],
    amount,
    paymentDate: value.paymentDate,
    paymentMethod: value.paymentMethod as NativeCollectionRequest["paymentMethod"],
    allocations,
  };
  for (const [key, limit] of [
    ["externalReceiptNo", 200],
    ["actualCollector", 100],
    ["collectorBasis", 1000],
    ["notes", 2000],
  ] as const)
    if (value[key] !== undefined) result[key] = text(value[key], limit);
  if (!!result.actualCollector !== !!result.collectorBasis) throw invalid();
  if (value.coverage !== undefined) result.coverage = coverage(value.coverage);
  return result;
}

export function parseNativeSelector(value: unknown) {
  if (!nativeObject(value) || !nativeOnlyKeys(value, ["contractId", "buildingCode", "unitNo"]))
    throw new NativeCollectionFailure("invalid_native_selector");
  if (value.contractId !== undefined) {
    if (value.buildingCode !== undefined || value.unitNo !== undefined)
      throw new NativeCollectionFailure("invalid_native_selector");
    return { contractId: id(value.contractId) };
  }
  return { buildingCode: text(value.buildingCode, 40), unitNo: text(value.unitNo, 40) };
}
