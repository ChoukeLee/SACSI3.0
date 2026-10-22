import {
  nativeMoney,
  nativeMoneyMinor,
  nativeObject,
  nativeUuid,
  type NativeCollectionRequest,
} from "./operator-native-collection";

function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || !value.every(nativeObject))
    throw new Error("invalid_evidence");
  return value;
}
function identifierMap(rows: Record<string, unknown>[], key: string) {
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!nativeUuid(row[key]) || result.has(row[key] as string))
      throw new Error("invalid_evidence");
    result.set(row[key] as string, row);
  }
  return result;
}
function isoOrNull(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "string" &&
      /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value)
  );
}

/** Verify actual native rows, not a bare success flag or an empty XOF array. */
export function verifyNativeCollectionResult(
  result: unknown,
  input: NativeCollectionRequest,
  actorId: string,
): boolean {
  try {
    if (
      !nativeObject(result) ||
      result.status !== "completed" ||
      result.verified !== true ||
      result.requestId !== input.requestId ||
      result.contractId !== input.contractId ||
      result.currency !== input.currency ||
      result.amount !== input.amount ||
      !Array.isArray(result.paymentIds) ||
      // One contract, one native lease-rent group: never accept extra payments.
      result.paymentIds.length !== 1 ||
      !result.paymentIds.every(nativeUuid) ||
      new Set(result.paymentIds).size !== result.paymentIds.length ||
      !nativeObject(result.verification) ||
      !isoOrNull(result.paidThroughBefore) ||
      !isoOrNull(result.paidThroughAfter)
    )
      return false;
    if (
      input.coverage
        ? result.paidThroughBefore !== input.coverage.expectedPaidThroughDate ||
          result.paidThroughAfter !== input.coverage.throughDate
        : result.paidThroughBefore !== result.paidThroughAfter
    )
      return false;
    const proof = result.verification;
    if (
      proof.version !== 1 ||
      proof.actorId !== actorId ||
      !nativeObject(proof.checks) ||
      !["payments", "ledger", "allocations", "receivables", "audit", "xofUnchanged"].every(
        (key) => (proof.checks as Record<string, unknown>)[key] === true,
      )
    )
      return false;
    const payments = identifierMap(list(proof.payments), "id");
    const ledger = identifierMap(list(proof.ledger), "paymentId");
    const balances = identifierMap(list(proof.receivables), "id");
    const paymentIds = result.paymentIds as string[];
    if (
      payments.size !== paymentIds.length ||
      ledger.size !== paymentIds.length ||
      balances.size !== input.allocations.length
    )
      return false;
    let paid = BigInt(0);
    for (const paymentId of paymentIds) {
      const payment = payments.get(paymentId),
        entry = ledger.get(paymentId);
      if (
        !payment ||
        !entry ||
        payment.currency !== input.currency ||
        payment.nativeSettlement !== true ||
        payment.exchangeRateToXof !== null ||
        payment.recordedBy !== actorId ||
        entry.currency !== input.currency ||
        entry.amountXof !== "0.00" ||
        nativeMoney(payment.amount) !== payment.amount ||
        entry.amount !== payment.amount
      )
        return false;
      paid += nativeMoneyMinor(payment.amount);
    }
    if (paid !== nativeMoneyMinor(input.amount)) return false;
    for (const rows of [list(result.allocations), list(proof.allocations)]) {
      const allocations = identifierMap(rows, "receivableId");
      const referenced = new Set<string>();
      if (allocations.size !== input.allocations.length) return false;
      for (const expected of input.allocations) {
        const actual = allocations.get(expected.receivableId);
        if (
          !actual ||
          actual.amount !== expected.amount ||
          !paymentIds.includes(String(actual.paymentId))
        )
          return false;
        referenced.add(actual.paymentId as string);
      }
      if (referenced.size !== paymentIds.length) return false;
    }
    for (const expected of input.allocations) {
      const actual = balances.get(expected.receivableId);
      if (
        !actual ||
        actual.currency !== input.currency ||
        actual.amountXof !== "0.00" ||
        actual.paidAmountXof !== "0.00"
      )
        return false;
      const before = nativeMoneyMinor(actual.paidBefore, true),
        after = nativeMoneyMinor(actual.paidAfter, true);
      if (
        after - before !== nativeMoneyMinor(expected.amount) ||
        after > nativeMoneyMinor(actual.amount)
      )
        return false;
    }
    const audit = proof.audit;
    return (
      nativeObject(audit) &&
      nativeUuid(audit.id) &&
      audit.actorId === actorId &&
      audit.requestId === input.requestId &&
      audit.channel === "external_codex" &&
      audit.authorization === "explicit_instruction"
    );
  } catch {
    return false;
  }
}
