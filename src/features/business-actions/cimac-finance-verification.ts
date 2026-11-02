import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import {
  cimacFinanceDate,
  cimacFinanceObject,
  cimacFinanceUuid,
  type CimacFinanceRequest,
} from "./cimac-finance";

type Row = Record<string, unknown>;
/** Mirrors the audited database child UUID namespace; never a new request ID. */
export function cimacFinanceChildId(requestId: string, part: string): string {
  const h = createHash("md5").update(`${requestId}:${part}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const reject = (): never => {
  throw new Error("invalid_cimac_finance_evidence");
};
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.length > 20000 || !value.every(cimacFinanceObject))
    return reject();
  return value;
}
function ids(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every(cimacFinanceUuid) ||
    new Set(value).size !== value.length
  )
    return reject();
  return value;
}
function map(value: unknown): Map<string, Row> {
  const result = new Map<string, Row>();
  for (const row of rows(value)) {
    if (!cimacFinanceUuid(row.id) || result.has(row.id)) return reject();
    result.set(row.id, row);
  }
  return result;
}
function sameIds(value: unknown, expected: string[]) {
  const actual = ids(value);
  return actual.length === expected.length && expected.every((id) => actual.includes(id));
}
/** Raw public numeric rows may arrive as JSON numbers or decimal strings. */
function minor(value: unknown): bigint {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100)
  )
    return reject();
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(raw)) return reject();
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}
function equalAmount(actual: unknown, expected: unknown) {
  return minor(actual) === minor(expected);
}
function converted(amount: unknown, rate: unknown): bigint {
  const raw = typeof rate === "number" ? String(rate) : rate;
  if (typeof raw !== "string" || !/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(raw)) return reject();
  const [whole, fraction = ""] = raw.split(".");
  const scaled = BigInt(whole + fraction),
    scale = BigInt(10) ** BigInt(fraction.length);
  if (scaled <= BigInt(0)) return reject();
  return (minor(amount) * scaled + scale / BigInt(2)) / scale;
}
function textContains(value: unknown, expected: string) {
  return typeof value === "string" && value.includes(expected);
}
function except(row: Row, keys: string[]) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}
function unstarted(contract: Row) {
  return (
    contract.status === "draft" &&
    contract.commencement_state === "pending_project_opening" &&
    contract.start_date === null &&
    contract.expected_end_date === null &&
    contract.actual_end_date === null
  );
}
function shop(unit: Row) {
  return (
    unit.kind === "storefront" &&
    unit.asset_subtype === "commercial_shop" &&
    typeof unit.unit_no === "string" &&
    /^\d{3,4}$/.test(unit.unit_no) &&
    unit.unit_no !== "231" &&
    cimacFinanceUuid(unit.building_id) &&
    unit.status === "reserved"
  );
}
function systemReference(payment: Row, unit: Row, source: "lease_deposit" | "property_fee") {
  const business = source === "lease_deposit" ? "DEP" : "PROP";
  return (
    typeof payment.receipt_no === "string" &&
    new RegExp(
      `^WB-CIMAC-B\\d{2}-L-${unit.unit_no}-${String(payment.payment_date).replaceAll("-", "")}-${business}-\\d{2,}$`,
    ).test(payment.receipt_no)
  );
}
function matchingLedger(payment: Row, entry: Row, category: string) {
  return (
    entry.payment_id === payment.id &&
    entry.unit_id === payment.unit_id &&
    entry.entry_date === payment.payment_date &&
    entry.category === category &&
    entry.direction === (category === "lease_deposit" ? "liability_in" : "income") &&
    entry.currency === "XOF" &&
    entry.amount_native === null &&
    entry.amount_cny === null &&
    equalAmount(entry.amount_xof, payment.amount)
  );
}
function depositFlags(
  proof: Row,
  contracts: Map<string, Row>,
  units: Map<string, Row>,
  checked: Set<string>,
) {
  const payments = map(proof.depositPayments),
    ledger = map(proof.depositLedger);
  const seen = new Set<string>(),
    balances = new Map<string, bigint>();
  for (const payment of payments.values()) {
    const contract = contracts.get(String(payment.source_id));
    if (
      !contract ||
      minor(payment.amount) <= BigInt(0) ||
      payment.unit_id !== contract.unit_id ||
      payment.customer_id !== contract.customer_id ||
      !["XOF", "CNY", "USD"].includes(String(payment.currency)) ||
      !["lease_deposit", "lease_deposit_refund", "lease_deposit_deduction"].includes(
        String(payment.source_type),
      ) ||
      (payment.currency === "XOF" && !equalAmount(payment.exchange_rate_to_xof, "1"))
    )
      return false;
    const known =
      rows(proof.payments).find((row) => row.id === payment.id) ??
      rows(proof.reclassifications)
        .map((row) => row.paymentAfter)
        .find((row) => cimacFinanceObject(row) && row.id === payment.id);
    if (known && !isDeepStrictEqual(known, payment)) return false;
    const linked = [...ledger.values()].filter((entry) => entry.payment_id === payment.id);
    if (linked.length !== 1) return false;
    const entry = linked[0],
      incoming = payment.source_type === "lease_deposit";
    if (
      entry.unit_id !== contract.unit_id ||
      entry.building_id !== units.get(String(contract.unit_id))?.building_id ||
      entry.entry_date !== payment.payment_date ||
      entry.category !== "lease_deposit" ||
      entry.direction !== (incoming ? "liability_in" : "liability_out")
    )
      return false;
    seen.add(String(entry.id));
    // An unrelated original-currency deposit remains unvalued. It may be
    // displayed during identity/property work, but cannot prove an XOF flag.
    if (payment.native_settlement === true) {
      if (
        checked.has(String(contract.id)) ||
        !["CNY", "USD"].includes(String(payment.currency)) ||
        payment.exchange_rate_to_xof !== null ||
        entry.currency !== payment.currency ||
        minor(entry.amount_xof) !== BigInt(0) ||
        !equalAmount(entry.amount_native, payment.amount)
      )
        return false;
      continue;
    }
    const amount = converted(payment.amount, payment.exchange_rate_to_xof);
    if (
      payment.native_settlement !== false ||
      entry.currency !== "XOF" ||
      entry.amount_native !== null ||
      minor(entry.amount_xof) !== amount
    )
      return false;
    balances.set(
      String(contract.id),
      (balances.get(String(contract.id)) ?? BigInt(0)) + (incoming ? amount : -amount),
    );
  }
  if (seen.size !== ledger.size) return false;
  for (const id of checked) {
    const contract = contracts.get(id)!;
    const amount = balances.get(id) ?? BigInt(0);
    if (
      amount < BigInt(0) ||
      contract.deposit_received !== amount >= minor(contract.deposit_amount_xof)
    )
      return false;
  }
  return true;
}

/** Independently bind every new or corrected row to the exact authorized input. */
export function verifyCimacFinanceResult(
  value: unknown,
  request: CimacFinanceRequest,
  actorId: string,
): boolean {
  try {
    if (
      !cimacFinanceObject(value) ||
      value.status !== "completed" ||
      value.verified !== true ||
      value.idempotent !== false ||
      value.requestId !== request.requestId ||
      value.actorId !== actorId ||
      !isDeepStrictEqual(value.request, request) ||
      value.operationCount !== request.operations.length ||
      !cimacFinanceUuid(value.auditId) ||
      !cimacFinanceObject(value.verification)
    )
      return false;
    const proof = value.verification;
    if (
      proof.version !== 1 ||
      proof.actorId !== actorId ||
      !cimacFinanceObject(proof.checks) ||
      ![
        "scope",
        "payments",
        "ledger",
        "receivables",
        "contracts",
        "units",
        "cashFactsPreserved",
        "audit",
        "exclusions",
      ].every((key) => (proof.checks as Row)[key] === true)
    )
      return false;
    const payments = map(proof.payments),
      ledger = map(proof.ledger),
      receivables = map(proof.receivables),
      contracts = map(proof.contracts),
      units = map(proof.units),
      customers = map(proof.customers),
      operations = rows(value.operationResults),
      reclassifications = rows(proof.reclassifications);
    const expectedNew = request.operations.reduce(
      (sum, op) =>
        sum +
        (op.type === "collect" ? op.parts.length : op.type === "new_deposit" ? op.units.length : 0),
      0,
    );
    const expectedBills = request.operations.reduce(
      (sum, op) =>
        sum + (op.type === "collect" && op.category === "property_fee" ? op.parts.length : 0),
      0,
    );
    if (
      payments.size !== expectedNew ||
      ledger.size !== expectedNew ||
      receivables.size !== expectedBills ||
      !sameIds(value.paymentIds, [...payments.keys()]) ||
      operations.length !== request.operations.length ||
      reclassifications.length !==
        request.operations.filter((op) => op.type === "reclassify").length
    )
      return false;
    const usedPayments = new Set<string>(),
      usedLedger = new Set<string>(),
      usedBills = new Set<string>(),
      usedUnits = new Set<string>(),
      usedContracts = new Set<string>(),
      usedCustomers = new Set<string>(),
      checkedDeposit = new Set<string>(),
      usedReclass = new Set<string>();
    for (const unit of units.values()) if (!shop(unit)) return false;
    for (const contract of contracts.values())
      if (
        !unstarted(contract) ||
        !units.has(String(contract.unit_id)) ||
        !cimacFinanceUuid(contract.customer_id)
      )
        return false;
    for (let index = 0; index < request.operations.length; index++) {
      const op = request.operations[index],
        actual = operations[index];
      if (actual.index !== index || actual.type !== op.type || !cimacFinanceUuid(actual.customerId))
        return false;
      const customer = customers.get(actual.customerId);
      if (!customer || (op.type !== "reclassify" && customer.name !== op.customerName))
        return false;
      usedCustomers.add(actual.customerId);
      const unitIds = ids(actual.unitIds),
        contractIds = ids(actual.contractIds),
        paymentIds = ids(actual.paymentIds),
        ledgerIds = ids(actual.ledgerIds),
        billIds = ids(actual.receivableIds);
      if (!unitIds.length || !contractIds.length || unitIds.length !== contractIds.length)
        return false;
      const scopedUnits = unitIds.map((id) => units.get(id) ?? reject()),
        scopedContracts = contractIds.map((id) => contracts.get(id) ?? reject());
      if (
        scopedContracts.some(
          (c) => c.customer_id !== actual.customerId || !unitIds.includes(String(c.unit_id)),
        ) ||
        new Set(scopedContracts.map((c) => c.unit_id)).size !== unitIds.length
      )
        return false;
      for (const id of unitIds) usedUnits.add(id);
      for (const id of contractIds) usedContracts.add(id);
      if (op.type === "reclassify") {
        if (
          unitIds.length !== 1 ||
          contractIds.length !== 1 ||
          billIds.length ||
          !sameIds(paymentIds, [op.paymentId])
        )
          return false;
        const doc = reclassifications.find(
          (row) => cimacFinanceObject(row.paymentBefore) && row.paymentBefore.id === op.paymentId,
        );
        if (
          !doc ||
          usedReclass.has(op.paymentId) ||
          !cimacFinanceObject(doc.paymentBefore) ||
          !cimacFinanceObject(doc.paymentAfter) ||
          !cimacFinanceObject(doc.ledgerBefore) ||
          !cimacFinanceObject(doc.ledgerAfter)
        )
          return false;
        const before = doc.paymentBefore,
          after = doc.paymentAfter,
          entryBefore = doc.ledgerBefore,
          entryAfter = doc.ledgerAfter;
        if (
          !sameIds(ledgerIds, [String(entryBefore.id)]) ||
          !cimacFinanceUuid(entryBefore.id) ||
          before.id !== op.paymentId ||
          before.source_type !== op.expectedSourceType ||
          after.source_type !== op.targetSourceType ||
          !isDeepStrictEqual(except(before, ["source_type"]), except(after, ["source_type"])) ||
          before.currency !== "CNY" ||
          before.native_settlement !== false ||
          !equalAmount(before.amount, op.amountCny) ||
          before.source_id !== contractIds[0] ||
          before.unit_id !== unitIds[0] ||
          before.customer_id !== actual.customerId ||
          before.reversal_of_payment_id !== null ||
          !cimacFinanceDate(before.payment_date) ||
          typeof before.receipt_no !== "string" ||
          !before.receipt_no ||
          ![
            "external_receipt_no",
            "notes",
            "created_at",
            "recorded_by",
            "request_id",
            "request_kind",
          ].every((key) => Object.hasOwn(before, key)) ||
          !(
            before.payment_method === null ||
            ["cash", "bank_transfer", "check", "other"].includes(String(before.payment_method))
          ) ||
          !isDeepStrictEqual(
            except(entryBefore, ["direction", "category", "description"]),
            except(entryAfter, ["direction", "category", "description"]),
          ) ||
          entryBefore.payment_id !== op.paymentId ||
          entryBefore.unit_id !== before.unit_id ||
          entryBefore.entry_date !== before.payment_date ||
          entryBefore.currency !== "XOF" ||
          entryBefore.amount_native !== null ||
          minor(entryBefore.amount_xof) !== converted(before.amount, before.exchange_rate_to_xof) ||
          entryBefore.category !== op.expectedSourceType ||
          entryAfter.category !== op.targetSourceType ||
          entryBefore.direction !==
            (op.expectedSourceType === "lease_deposit" ? "liability_in" : "income") ||
          entryAfter.direction !==
            (op.targetSourceType === "lease_deposit" ? "liability_in" : "income") ||
          !textContains(entryAfter.description, op.annotation) ||
          !textContains(scopedContracts[0].source_reference, op.annotation) ||
          !textContains(scopedUnits[0].notes, op.annotation)
        )
          return false;
        usedReclass.add(op.paymentId);
        checkedDeposit.add(contractIds[0]);
        continue;
      }
      if (op.type === "identity") {
        if (
          actual.customerId !== op.customerId ||
          paymentIds.length ||
          ledgerIds.length ||
          billIds.length ||
          unitIds.length !== op.units.length
        )
          return false;
        for (const expected of op.units) {
          const unit = scopedUnits.find((row) => row.unit_no === expected.unitNo),
            contract = scopedContracts.find((row) => row.unit_id === unit?.id);
          if (
            !unit ||
            !contract ||
            unit.reservation_holder_name !== (op.holderName ?? expected.expectedHolderName) ||
            !textContains(unit.notes, op.annotation) ||
            !textContains(contract.source_reference, op.annotation) ||
            (op.managementNames &&
              !op.managementNames.every(
                (name) =>
                  textContains(unit.notes, name) && textContains(contract.source_reference, name),
              ))
          )
            return false;
        }
        continue;
      }
      const expectedParts = op.type === "collect" ? op.parts : op.units;
      if (
        paymentIds.length !== expectedParts.length ||
        ledgerIds.length !== expectedParts.length ||
        unitIds.length !== expectedParts.length ||
        billIds.length !==
          (op.type === "collect" && op.category === "property_fee" ? expectedParts.length : 0) ||
        (op.type === "collect" &&
          (!sameIds(
            contractIds,
            op.parts.map((part) => part.contractId),
          ) ||
            actual.customerId !== op.customerId))
      )
        return false;
      const category = op.type === "collect" ? op.category : "lease_deposit";
      let receiptTotal = BigInt(0);
      for (const [partIndex, part] of expectedParts.entries()) {
        const partKey = `${index + 1}:${partIndex + 1}`;
        const contract =
          "contractId" in part
            ? contracts.get(part.contractId)
            : scopedContracts.find((c) =>
                scopedUnits.some((u) => u.id === c.unit_id && u.unit_no === part.unitNo),
              );
        const unit = contract && units.get(String(contract.unit_id));
        if (
          !contract ||
          !unit ||
          !contractIds.includes(String(contract.id)) ||
          (op.type === "new_deposit" && unit.reservation_holder_name !== op.customerName)
        )
          return false;
        const payment = paymentIds
          .map((id) => payments.get(id))
          .find((row) => row?.source_id === contract.id);
        const entry = ledgerIds
          .map((id) => ledger.get(id))
          .find((row) => row?.payment_id === payment?.id);
        if (
          !payment ||
          !entry ||
          usedPayments.has(String(payment.id)) ||
          usedLedger.has(String(entry.id)) ||
          payment.customer_id !== actual.customerId ||
          payment.unit_id !== unit.id ||
          payment.source_type !== category ||
          payment.currency !== "XOF" ||
          payment.native_settlement !== false ||
          !equalAmount(payment.exchange_rate_to_xof, "1") ||
          !equalAmount(payment.amount, part.amountXof) ||
          payment.payment_date !== op.receipt.paymentDate ||
          payment.payment_method !== "cash" ||
          payment.recorded_by !== actorId ||
          payment.request_kind !== "cimac_finance" ||
          payment.id !== cimacFinanceChildId(request.requestId, `${partKey}:payment`) ||
          payment.request_id !== cimacFinanceChildId(request.requestId, `${partKey}:request`) ||
          entry.id !== cimacFinanceChildId(request.requestId, `${partKey}:ledger`) ||
          payment.reversal_of_payment_id !== null ||
          (payment.actual_collector !== null && payment.actual_collector !== undefined) ||
          payment.external_receipt_no !== (op.receipt.externalReceiptNo ?? null) ||
          !systemReference(payment, unit, category) ||
          !textContains(payment.notes, op.receipt.sourceText) ||
          !matchingLedger(payment, entry, category) ||
          entry.building_id !== unit.building_id
        )
          return false;
        receiptTotal += minor(payment.amount);
        usedPayments.add(String(payment.id));
        usedLedger.add(String(entry.id));
        if (category === "lease_deposit") checkedDeposit.add(String(contract.id));
        if (op.type === "new_deposit" && "unitNo" in part) {
          if (
            actual.customerId !== cimacFinanceChildId(request.requestId, `${index + 1}:customer`) ||
            contract.id !== cimacFinanceChildId(request.requestId, `${partKey}:contract`) ||
            !equalAmount(contract.monthly_rent_xof, part.monthlyRentXof) ||
            !equalAmount(contract.deposit_amount_xof, part.depositXof) ||
            contract.deposit_months !== 3 ||
            contract.signer_name !== null ||
            contract.signed_date != null ||
            contract.signing_state !== "pending_confirmation" ||
            contract.expected_end_confirmed !== false ||
            contract.paid_through_date !== null ||
            contract.rent_currency !== "XOF" ||
            contract.monthly_rent_amount !== null ||
            contract.free_months !== 12 ||
            !["2028-04-01", "2027-04-01", "2028-03-31", "900"].every((value) =>
              textContains(contract.source_reference, value),
            )
          )
            return false;
        }
        if (op.type === "collect" && op.category === "property_fee" && "contractId" in part) {
          const bill = billIds
            .map((id) => receivables.get(id))
            .find((row) => row?.source_id === contract.id);
          const discount = minor(part.discountXof ?? "0"),
            gross = minor(part.amountXof) + discount;
          if (
            !bill ||
            bill.id !== cimacFinanceChildId(request.requestId, `${partKey}:receivable`) ||
            !op.servicePeriod ||
            usedBills.has(String(bill.id)) ||
            bill.category !== "property_fee" ||
            bill.source_type !== "lease_contract" ||
            bill.unit_id !== unit.id ||
            bill.building_id !== unit.building_id ||
            bill.customer_id !== actual.customerId ||
            bill.currency !== "XOF" ||
            bill.amount_native !== null ||
            bill.paid_amount_native !== null ||
            bill.management_status !== "managed" ||
            bill.status !== "paid" ||
            !equalAmount(bill.amount_xof, part.amountXof) ||
            !equalAmount(bill.paid_amount_xof, part.amountXof) ||
            bill.due_date !== op.servicePeriod.start ||
            bill.service_period_start !== op.servicePeriod.start ||
            bill.service_period_end !== op.servicePeriod.end ||
            gross !== minor(unit.area_sqm) * BigInt(900 * 12) ||
            !textContains(bill.title, String(gross / BigInt(100))) ||
            !textContains(bill.title, String(discount / BigInt(100)))
          )
            return false;
          usedBills.add(String(bill.id));
        }
      }
      if (receiptTotal !== minor(op.receipt.amountXof)) return false;
    }
    if (
      usedPayments.size !== payments.size ||
      usedLedger.size !== ledger.size ||
      usedBills.size !== receivables.size ||
      usedUnits.size !== units.size ||
      usedContracts.size !== contracts.size ||
      usedCustomers.size !== customers.size ||
      usedReclass.size !== reclassifications.length ||
      !depositFlags(proof, contracts, units, checkedDeposit)
    )
      return false;
    const allocations = rows(proof.allocations);
    if (allocations.length !== receivables.size) return false;
    const allocated = new Set<string>();
    for (const allocation of allocations) {
      const bill = receivables.get(String(allocation.receivable_id)),
        payment = payments.get(String(allocation.payment_id));
      if (
        !bill ||
        !payment ||
        allocated.has(String(bill.id)) ||
        payment.source_type !== "property_fee" ||
        payment.source_id !== bill.source_id ||
        !equalAmount(allocation.amount_xof, bill.amount_xof) ||
        !equalAmount(allocation.amount_xof, payment.amount)
      )
        return false;
      allocated.add(String(bill.id));
    }
    const audit = proof.audit;
    return (
      cimacFinanceObject(audit) &&
      audit.id === value.auditId &&
      audit.actorId === actorId &&
      audit.requestId === request.requestId &&
      audit.channel === "external_codex" &&
      audit.authorization === "explicit_instruction"
    );
  } catch {
    return false;
  }
}
