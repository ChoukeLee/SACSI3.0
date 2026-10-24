import { isDeepStrictEqual } from "node:util";
import {
  cimacMoney,
  cimacObject,
  cimacUuid,
  type CimacMaintenanceOperation,
  type CimacMaintenanceRequest,
  type CimacReceipt,
} from "./cimac-maintenance";

function identifiers(value: unknown, allowEmpty = false): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every(cimacUuid) &&
    new Set(value).size === value.length
  );
}
function sameIds(actual: unknown, expected: string[]): boolean {
  return (
    identifiers(actual, true) &&
    actual.length === expected.length &&
    expected.every((id) => actual.includes(id))
  );
}
function decimalMinor(value: unknown): bigint {
  const canonical = cimacMoney(value, "CNY", true);
  return BigInt(canonical.replace(".", ""));
}
function sameRate(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => {
    if (typeof value !== "string" || !/^\d+(\.\d{1,12})?$/.test(value))
      throw new Error("invalid_rate");
    const [whole, fraction = ""] = value.split(".");
    return `${BigInt(whole)}.${fraction.replace(/0+$/, "")}`;
  };
  return normalize(left) === normalize(right);
}
function convertedMinor(amount: string, rate: unknown): bigint {
  if (typeof rate !== "string" || !/^\d+(\.\d{1,12})?$/.test(rate)) throw new Error("invalid_rate");
  const [whole, fraction = ""] = rate.split(".");
  const scale = BigInt(10) ** BigInt(fraction.length);
  const integerRate = BigInt(whole + fraction);
  if (integerRate <= BigInt(0)) throw new Error("invalid_rate");
  // PostgreSQL numeric round to cents, without converting money to IEEE doubles.
  return (decimalMinor(amount) * integerRate + scale / BigInt(2)) / scale;
}
function expectedPayments(
  operation: CimacMaintenanceOperation,
): Array<{ receipt: CimacReceipt; refund: boolean; native: boolean | null }> {
  switch (operation.type) {
    case "close":
      return [
        ...(operation.noteReceipt
          ? [{ receipt: operation.noteReceipt, refund: false, native: true }]
          : []),
        { receipt: operation.refund, refund: true, native: operation.noteReceipt ? true : null },
      ];
    case "replace":
      return [
        { receipt: operation.refund, refund: true, native: null },
        { receipt: operation.receipt, refund: false, native: false },
      ];
    case "note_receipt":
      return [{ receipt: operation.receipt, refund: false, native: true }];
    default:
      return [];
  }
}

/** Require row evidence and bounded side effects; never trust a bare verified flag. */
export function verifyCimacMaintenanceResult(
  value: unknown,
  request: CimacMaintenanceRequest,
  actorId: string,
): boolean {
  try {
    if (
      !cimacObject(value) ||
      value.status !== "completed" ||
      value.verified !== true ||
      value.requestId !== request.requestId ||
      !isDeepStrictEqual(value.request, request) ||
      value.actorId !== actorId ||
      value.operationCount !== request.operations.length ||
      !cimacUuid(value.auditId) ||
      !identifiers(value.paymentIds, true) ||
      !Array.isArray(value.operationResults) ||
      value.operationResults.length !== request.operations.length ||
      !Array.isArray(value.payments) ||
      !cimacObject(value.reconciliation)
    )
      return false;
    const reconciliation = value.reconciliation;
    if (
      reconciliation.receivablesCreated !== 0 ||
      ![
        "originalPaymentsPreserved",
        "contractsMatch",
        "unitsMatch",
        "paymentsMatch",
        "ledgerMatch",
        "auditMatch",
      ].every((key) => reconciliation[key] === true)
    )
      return false;
    const expectedCount = request.operations.reduce(
      (sum, op) => sum + expectedPayments(op).length,
      0,
    );
    if (
      value.paymentIds.length !== expectedCount ||
      value.payments.length !== expectedCount ||
      reconciliation.paymentCount !== expectedCount ||
      reconciliation.ledgerCount !== expectedCount
    )
      return false;
    const rows = new Map<string, Record<string, unknown>>();
    const ledgerIds = new Set<string>();
    for (const payment of value.payments) {
      if (
        !cimacObject(payment) ||
        !cimacUuid(payment.id) ||
        rows.has(payment.id) ||
        !cimacUuid(payment.ledgerId) ||
        ledgerIds.has(payment.ledgerId) ||
        !cimacUuid(payment.sourceId) ||
        payment.recordedBy !== actorId ||
        !value.paymentIds.includes(payment.id)
      )
        return false;
      rows.set(payment.id, payment);
      ledgerIds.add(payment.ledgerId);
    }
    const linked = new Set<string>();
    for (let index = 0; index < request.operations.length; index++) {
      const op = request.operations[index],
        actual = value.operationResults[index];
      if (
        !cimacObject(actual) ||
        actual.type !== op.type ||
        !identifiers(actual.unitIds) ||
        !identifiers(actual.contractIds, true) ||
        !identifiers(actual.paymentIds, true)
      )
        return false;
      if (
        "contractIds" in op &&
        op.type !== "replace" &&
        !sameIds(actual.contractIds, op.contractIds)
      )
        return false;
      if (
        op.type === "replace" &&
        ((actual.contractIds as string[]).length !== 2 ||
          actual.contractIds[0] !== op.contractIds[0])
      )
        return false;
      const expectedUnits =
        "contractIds" in op ? op.contractIds.length : op.type === "reserve" ? op.unitNos.length : 1;
      if (actual.unitIds.length !== expectedUnits) return false;
      if (
        (op.type === "area" || op.type === "create_reservation") &&
        actual.contractIds.length !== 1
      )
        return false;
      // A reservation may have no signed lease; never invent contracts or receivables.
      if (op.type === "reserve" && actual.contractIds.length !== 0) return false;
      const expected = expectedPayments(op);
      if (actual.paymentIds.length !== expected.length) return false;
      const unmatched = [...expected];
      for (const paymentId of actual.paymentIds) {
        if (linked.has(paymentId)) return false;
        linked.add(paymentId);
        const payment = rows.get(paymentId);
        if (!payment || !(actual.contractIds as string[]).includes(payment.sourceId as string))
          return false;
        const match = unmatched.findIndex(
          ({ receipt, refund }) =>
            payment.paymentType === (refund ? "lease_deposit_refund" : "lease_deposit") &&
            payment.currency === receipt.currency &&
            payment.amount === receipt.amount &&
            payment.paymentDate === receipt.paymentDate &&
            payment.paymentMethod === receipt.paymentMethod,
        );
        if (match < 0) return false;
        const wanted = unmatched.splice(match, 1)[0];
        const expectedSource =
          op.type === "replace"
            ? actual.contractIds[wanted.refund ? 0 : 1]
            : op.type === "note_receipt"
              ? op.receipt.contractId
              : op.type === "close" && !wanted.refund
                ? op.noteReceipt?.contractId
                : null;
        if (
          expectedSource !== null &&
          expectedSource !== undefined &&
          payment.sourceId !== expectedSource
        )
          return false;
        if (wanted.refund && (op.type === "close" || op.type === "replace")) {
          if (
            !Array.isArray(payment.originalPayments) ||
            !payment.originalPayments.length ||
            !payment.originalPayments.every(cimacObject)
          )
            return false;
          const originals = payment.originalPayments as Record<string, unknown>[];
          const expectedOriginals =
            op.type === "close" && op.noteReceipt
              ? actual.paymentIds.filter((id) => rows.get(id)?.paymentType === "lease_deposit")
              : op.refund.originalPaymentIds;
          if (
            !sameIds(
              originals.map((row) => row.id),
              expectedOriginals,
            ) ||
            originals.some((row) => row.currency !== "CNY") ||
            originals.reduce((sum, row) => sum + decimalMinor(row.amount), BigInt(0)) !==
              decimalMinor(wanted.receipt.amount)
          )
            return false;
          if (
            wanted.native === true ||
            (wanted.native === null && payment.nativeSettlement === true)
          ) {
            if (
              originals.some(
                (row) => row.nativeSettlement !== true || row.exchangeRateToXof !== null,
              )
            )
              return false;
          } else if (
            originals.some(
              (row) =>
                row.nativeSettlement !== false ||
                !sameRate(row.exchangeRateToXof, payment.exchangeRateToXof),
            )
          )
            return false;
        }
        if (
          payment.ledgerCurrency !==
            (payment.nativeSettlement === true ? payment.currency : "XOF") ||
          payment.ledgerDirection !== (wanted.refund ? "liability_out" : "liability_in")
        )
          return false;
        if (
          wanted.native === true ||
          (wanted.native === null && payment.nativeSettlement === true)
        ) {
          if (
            payment.nativeSettlement !== true ||
            payment.exchangeRateToXof !== null ||
            decimalMinor(payment.ledgerAmountXof) !== BigInt(0) ||
            payment.ledgerAmountNative !== wanted.receipt.amount
          )
            return false;
        } else if (wanted.receipt.currency === "XOF") {
          if (
            payment.nativeSettlement !== false ||
            !sameRate(payment.exchangeRateToXof, "1") ||
            decimalMinor(payment.ledgerAmountXof) !== BigInt(wanted.receipt.amount) * BigInt(100) ||
            payment.ledgerAmountNative !== null
          )
            return false;
        } else {
          // Original converted deposits keep the historical currency/rate; no current FX is invented.
          if (
            payment.nativeSettlement !== false ||
            typeof payment.exchangeRateToXof !== "string" ||
            !/^\d+(\.\d+)?$/.test(payment.exchangeRateToXof) ||
            decimalMinor(payment.ledgerAmountXof) !==
              convertedMinor(wanted.receipt.amount, payment.exchangeRateToXof) ||
            payment.ledgerAmountNative !== null
          )
            return false;
        }
      }
      if (unmatched.length) return false;
    }
    return linked.size === expectedCount;
  } catch {
    return false;
  }
}
