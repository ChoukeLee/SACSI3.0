import type { LeaseCollectionInput, LeaseCollectionSuccess } from "./lease-collection-types";
import { moneyMinor } from "./lease-collection-model";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new Error("invalidLeaseCollection");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown) {
  if (typeof value !== "string" || !uuid.test(value)) throw invalid();
  return value.toLowerCase();
}
function money(value: unknown) {
  const minor = typeof value === "number" ? moneyMinor(value) : null;
  if (minor === null || minor <= 0) throw invalid();
  return minor;
}
function optionalText(value: unknown, limit: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > limit) throw invalid();
  return value.trim() || undefined;
}
function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
function isoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

/** Defend the server action as an independent transport, not just its form. */
export function parseLeaseCollectionInput(value: unknown): LeaseCollectionInput {
  const input = object(value);
  if (
    Object.keys(input).some(
      (key) =>
        ![
          "contractId",
          "paymentDate",
          "currency",
          "amount",
          "paymentMethod",
          "externalReceiptNo",
          "actualCollector",
          "collectorBasis",
          "notes",
          "allocations",
          "coverage",
          "requestId",
        ].includes(key),
    )
  )
    throw invalid();
  const contractId = identifier(input.contractId),
    requestId = identifier(input.requestId);
  const paymentDate = input.paymentDate;
  if (
    typeof paymentDate !== "string" ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
    !Number.isFinite(Date.parse(paymentDate + "T00:00:00Z")) ||
    new Date(paymentDate + "T00:00:00Z").toISOString().slice(0, 10) !== paymentDate ||
    paymentDate > new Date().toISOString().slice(0, 10) ||
    typeof input.currency !== "string" ||
    !["XOF", "USD", "CNY"].includes(input.currency) ||
    typeof input.paymentMethod !== "string" ||
    !["cash", "check", "bank_transfer", "other"].includes(input.paymentMethod) ||
    !Array.isArray(input.allocations) ||
    !input.allocations.length ||
    input.allocations.length > 100
  )
    throw invalid();
  const total = money(input.amount);
  const allocations = input.allocations.map((raw) => {
    const item = object(raw);
    if (
      Object.keys(item).some(
        (key) =>
          !["receivableId", "amount", "expectedOutstanding", "expectedUpdatedAt"].includes(key),
      )
    )
      throw invalid();
    const receivableId = identifier(item.receivableId);
    const amount = money(item.amount),
      outstanding = money(item.expectedOutstanding);
    if (amount > outstanding) throw invalid();
    if (
      item.expectedUpdatedAt !== undefined &&
      (typeof item.expectedUpdatedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T/.test(item.expectedUpdatedAt) ||
        !Number.isFinite(Date.parse(item.expectedUpdatedAt)))
    )
      throw invalid();
    return {
      receivableId,
      amount: amount / 100,
      expectedOutstanding: outstanding / 100,
      ...(item.expectedUpdatedAt === undefined
        ? {}
        : { expectedUpdatedAt: item.expectedUpdatedAt as string }),
    };
  });
  if (
    new Set(allocations.map((row) => row.receivableId)).size !== allocations.length ||
    allocations.reduce((sum, row) => sum + BigInt(money(row.amount)), BigInt(0)) !== BigInt(total)
  )
    throw invalid();
  const actualCollector = optionalText(input.actualCollector, 100);
  const collectorBasis = optionalText(input.collectorBasis, 1000);
  if (!!actualCollector !== !!collectorBasis) throw invalid();
  const externalReceiptNo = optionalText(input.externalReceiptNo, 200);
  const notes = optionalText(input.notes, 2000);
  let coverage: LeaseCollectionInput["coverage"];
  if (input.coverage !== undefined) {
    const raw = object(input.coverage);
    if (
      Object.keys(raw).some(
        (key) =>
          ![
            "expectedPaidThroughDate",
            "expectedContractUpdatedAt",
            "throughDate",
            "receivableIds",
          ].includes(key),
      ) ||
      !isoDate(raw.expectedPaidThroughDate) ||
      !isoDate(raw.throughDate) ||
      raw.throughDate <= raw.expectedPaidThroughDate ||
      !isoTimestamp(raw.expectedContractUpdatedAt) ||
      !Array.isArray(raw.receivableIds) ||
      !raw.receivableIds.length ||
      raw.receivableIds.length > 100
    )
      throw invalid();
    const receivableIds = raw.receivableIds.map(identifier);
    if (
      new Set(receivableIds).size !== receivableIds.length ||
      !receivableIds.some((id) => allocations.some((a) => a.receivableId === id))
    )
      throw invalid();
    coverage = {
      expectedPaidThroughDate: raw.expectedPaidThroughDate,
      expectedContractUpdatedAt: raw.expectedContractUpdatedAt,
      throughDate: raw.throughDate,
      receivableIds,
    };
  }
  return {
    contractId,
    requestId,
    paymentDate,
    currency: input.currency as LeaseCollectionInput["currency"],
    amount: total / 100,
    paymentMethod: input.paymentMethod as LeaseCollectionInput["paymentMethod"],
    allocations,
    ...(externalReceiptNo ? { externalReceiptNo } : {}),
    ...(actualCollector ? { actualCollector, collectorBasis } : {}),
    ...(notes ? { notes } : {}),
    ...(coverage ? { coverage } : {}),
  };
}

/** Independently verify persisted facts when the original browser draft is gone. */
export function decodeLeaseCollectionReceipt(
  value: unknown,
  requestId: string,
): LeaseCollectionSuccess {
  const result = object(value);
  if (
    result.success !== true ||
    result.requestId !== identifier(requestId) ||
    typeof result.currency !== "string" ||
    !["XOF", "USD", "CNY"].includes(result.currency) ||
    !Array.isArray(result.referenceNos) ||
    !result.referenceNos.length ||
    result.referenceNos.length > 2 ||
    !result.referenceNos.every(
      (ref) => typeof ref === "string" && !!ref.trim() && ref.length <= 200,
    ) ||
    new Set(result.referenceNos).size !== result.referenceNos.length ||
    !Array.isArray(result.paymentIds) ||
    result.paymentIds.length !== result.referenceNos.length ||
    (result.currency !== "XOF" && result.paymentIds.length !== 1) ||
    !result.paymentIds.every((id) => typeof id === "string" && uuid.test(id)) ||
    new Set(result.paymentIds).size !== result.paymentIds.length ||
    !Array.isArray(result.allocations) ||
    !result.allocations.length ||
    result.allocations.length > 100 ||
    (result.idempotent !== undefined && typeof result.idempotent !== "boolean")
  )
    throw invalid();
  if (
    (result.paidThroughBefore !== null && !isoDate(result.paidThroughBefore)) ||
    (result.paidThroughAfter !== null && !isoDate(result.paidThroughAfter))
  )
    throw invalid();
  const seen = new Set<string>();
  const usedPayments = new Set<string>();
  const currency = result.currency as LeaseCollectionInput["currency"];
  const total = money(result.totalAmount);
  let allocated = BigInt(0);
  const allocations = result.allocations.map((raw) => {
    const row = object(raw),
      id = identifier(row.receivableId),
      amount = money(row.amount);
    if (seen.has(id)) throw invalid();
    seen.add(id);
    const paymentId = identifier(row.paymentId);
    if (!(result.paymentIds as string[]).includes(paymentId) || row.currency !== currency)
      throw invalid();
    usedPayments.add(paymentId);
    allocated += BigInt(amount);
    return { receivableId: id, amount: amount / 100, paymentId, currency };
  });
  if (allocated !== BigInt(total) || usedPayments.size !== result.paymentIds.length)
    throw invalid();
  let coverage: LeaseCollectionSuccess["coverage"];
  if (result.coverage !== undefined) {
    const raw = object(result.coverage);
    if (
      Object.keys(raw).some((key) => !["throughDate", "receivableIds"].includes(key)) ||
      !isoDate(raw.throughDate) ||
      result.paidThroughBefore === null ||
      raw.throughDate !== result.paidThroughAfter ||
      raw.throughDate <= result.paidThroughBefore ||
      !Array.isArray(raw.receivableIds) ||
      !raw.receivableIds.length ||
      raw.receivableIds.length > 100
    )
      throw invalid();
    const receivableIds = raw.receivableIds.map(identifier);
    if (
      new Set(receivableIds).size !== receivableIds.length ||
      !receivableIds.some((id) => seen.has(id))
    )
      throw invalid();
    coverage = { throughDate: raw.throughDate, receivableIds };
  } else if (result.paidThroughBefore !== result.paidThroughAfter) throw invalid();
  return {
    success: true,
    requestId,
    currency,
    totalAmount: total / 100,
    paidThroughBefore: result.paidThroughBefore as string | null,
    paidThroughAfter: result.paidThroughAfter as string | null,
    ...(coverage ? { coverage } : {}),
    referenceNos: result.referenceNos as string[],
    paymentIds: result.paymentIds as string[],
    allocations,
    ...(result.idempotent === undefined ? {} : { idempotent: result.idempotent as boolean }),
  };
}

/** A malformed write response may already have committed: never report rejection. */
export function decodeLeaseCollectionResult(
  value: unknown,
  input: LeaseCollectionInput,
): LeaseCollectionSuccess {
  const result = decodeLeaseCollectionReceipt(value, input.requestId);
  if (
    result.currency !== input.currency ||
    money(result.totalAmount) !== money(input.amount) ||
    result.allocations.length !== input.allocations.length
  )
    throw invalid();
  const expected = new Map(input.allocations.map((row) => [row.receivableId, money(row.amount)]));
  for (const row of result.allocations)
    if (expected.get(row.receivableId) !== money(row.amount)) throw invalid();
  if (!!input.coverage !== !!result.coverage) throw invalid();
  if (
    input.coverage &&
    result.coverage &&
    (result.paidThroughBefore !== input.coverage.expectedPaidThroughDate ||
      result.coverage.throughDate !== input.coverage.throughDate ||
      result.coverage.receivableIds.length !== input.coverage.receivableIds.length ||
      !result.coverage.receivableIds.every((id) => input.coverage!.receivableIds.includes(id)))
  )
    throw invalid();
  return result;
}
