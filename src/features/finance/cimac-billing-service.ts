import type {
  CimacBillingWriteKind,
  CimacBillingWriteResult,
  CimacCollectionInput,
  CimacCollectionAdjustment,
  CimacCollectionPosition,
  CimacRefundInput,
  CimacReversalInput,
  CimacFeeTerm,
  CimacFeeTermInput,
  CimacMeterReading,
  CimacMeterReadingInput,
} from "./cimac-billing-types";

export type CimacRequestInput<T> = T & { requestId: string };
export type CimacWriteFailure = { success: false; rejected: boolean; error: string };
export type CimacWriteResult = CimacBillingWriteResult | CimacWriteFailure;
export type CimacWriteReceiptResult =
  | { status: "found"; receipt: CimacBillingWriteResult }
  | { status: "not_found" }
  | { status: "unavailable"; error: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const currencies = ["XOF", "USD", "CNY"] as const;
const categories = [
  "lease_rent",
  "lease_deposit",
  "property_fee",
  "water",
  "electricity",
  "management_fee",
] as const;
const invalid = () => new Error("invalidCimacBilling");

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw invalid();
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalid();
}

export function parseCimacRequestId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw invalid();
  return value.toLowerCase();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw invalid();
  return value as T;
}

function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit || value.includes("\0")) throw invalid();
  const result = value.trim();
  if (!result) throw invalid();
  return result;
}

function optionalText(value: unknown, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > limit || value.includes("\0")) throw invalid();
  return value.trim() || undefined;
}

function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw invalid();
  return value;
}

function optionalDate(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : date(value);
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw invalid();
  date(value.slice(0, 10));
  return value;
}

/** Decimal strings only: never coerce, round or transit through floating point. */
function decimal(value: unknown, scale: number, positive = false): string {
  if (typeof value !== "string" || value.length > 32 || !/^\d+(?:\.\d+)?$/.test(value))
    throw invalid();
  const [whole, fraction = ""] = value.split(".");
  if (whole.length > 12 || fraction.length > scale) throw invalid();
  const minor = BigInt(whole + fraction.padEnd(scale, "0"));
  if ((positive && minor === BigInt(0)) || minor > BigInt(`999999999999${"9".repeat(scale)}`))
    throw invalid();
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function minor(value: string, scale = 2): bigint {
  const [whole, fraction = ""] = decimal(value, scale).split(".");
  return BigInt(whole + fraction.padEnd(scale, "0"));
}

function xof(value: unknown, positive = false): string {
  const amount = decimal(value, 2, positive);
  if (minor(amount) % BigInt(100) !== BigInt(0)) throw invalid();
  return amount;
}

function optionalDecimal(value: unknown, scale: number, positive = false): string | undefined {
  return value === undefined || value === null ? undefined : decimal(value, scale, positive);
}

function revision(input: Record<string, unknown>): { id?: string; expectedUpdatedAt?: string } {
  if (input.id === undefined && input.expectedUpdatedAt === undefined) return {};
  return {
    id: parseCimacRequestId(input.id),
    expectedUpdatedAt: timestamp(input.expectedUpdatedAt),
  };
}

function positionToken(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{32}$/i.test(value)) throw invalid();
  return value.toLowerCase();
}

function parseAdjustment(value: unknown, kind: "refund" | "reversal") {
  const input = object(value);
  keys(input, [
    "requestId",
    "originalPaymentId",
    "customerId",
    "currency",
    "amount",
    "reason",
    "expectedPositionToken",
    "allocations",
    "notes",
    ...(kind === "refund" ? ["paymentDate", "paymentMethod", "externalReceiptNo"] : []),
  ]);
  const amount = xof(input.amount, true);
  if (
    !Array.isArray(input.allocations) ||
    !input.allocations.length ||
    input.allocations.length > 100
  )
    throw invalid();
  const allocations = input.allocations.map((raw) => {
    const row = object(raw);
    keys(row, ["receivableId", "amount", "expectedRemaining", "expectedPaid", "expectedUpdatedAt"]);
    const piece = xof(row.amount, true),
      expectedRemaining = xof(row.expectedRemaining, true),
      expectedPaid = decimal(row.expectedPaid, 2);
    if (
      minor(piece) > minor(expectedRemaining) ||
      minor(piece) > minor(expectedPaid) ||
      (kind === "reversal" && piece !== expectedRemaining)
    )
      throw invalid();
    return {
      receivableId: parseCimacRequestId(row.receivableId),
      amount: piece,
      expectedRemaining,
      expectedPaid,
      expectedUpdatedAt: timestamp(row.expectedUpdatedAt),
    };
  });
  if (
    new Set(allocations.map((row) => row.receivableId)).size !== allocations.length ||
    allocations.reduce((sum, row) => sum + minor(row.amount), BigInt(0)) !== minor(amount)
  )
    throw invalid();
  const notes = optionalText(input.notes, 2000);
  return {
    requestId: parseCimacRequestId(input.requestId),
    originalPaymentId: parseCimacRequestId(input.originalPaymentId),
    customerId: parseCimacRequestId(input.customerId),
    currency: oneOf(input.currency, ["XOF"]),
    amount,
    reason: text(input.reason, 1000),
    expectedPositionToken: positionToken(input.expectedPositionToken),
    allocations,
    ...(notes ? { notes } : {}),
  };
}

export function parseCimacRefundInput(value: unknown): CimacRequestInput<CimacRefundInput> {
  const common = parseAdjustment(value, "refund"),
    input = object(value);
  const paymentDate = date(input.paymentDate);
  if (paymentDate > new Date().toISOString().slice(0, 10)) throw invalid();
  const externalReceiptNo = optionalText(input.externalReceiptNo, 200);
  return {
    ...common,
    paymentDate,
    paymentMethod: oneOf(input.paymentMethod, ["cash", "check", "bank_transfer", "other"]),
    ...(externalReceiptNo ? { externalReceiptNo } : {}),
  };
}

export function parseCimacReversalInput(value: unknown): CimacRequestInput<CimacReversalInput> {
  return parseAdjustment(value, "reversal");
}

export function decodeCimacCollectionAdjustment(value: unknown): CimacCollectionAdjustment {
  const a = object(value),
    kind = oneOf(a.kind, ["refund", "reversal"] as const),
    amount = xof(a.amount, true),
    paymentDate = date(a.paymentDate),
    effectiveDate = date(a.effectiveDate),
    originalPaymentId = parseCimacRequestId(a.originalPaymentId);
  if (
    a.currency !== "XOF" ||
    paymentDate !== effectiveDate ||
    paymentDate > new Date().toISOString().slice(0, 10) ||
    !Array.isArray(a.allocations) ||
    !a.allocations.length ||
    a.allocations.length > 100
  )
    throw invalid();
  const allocations = a.allocations.map((raw) => {
    const link = object(raw);
    return { receivableId: parseCimacRequestId(link.receivableId), amount: xof(link.amount, true) };
  });
  if (
    new Set(allocations.map((l) => l.receivableId)).size !== allocations.length ||
    allocations.reduce((sum, l) => sum + minor(l.amount), BigInt(0)) !== minor(amount) ||
    a.paymentId === originalPaymentId
  )
    throw invalid();
  return {
    id: parseCimacRequestId(a.id),
    requestId: parseCimacRequestId(a.requestId),
    paymentId: parseCimacRequestId(a.paymentId),
    originalPaymentId,
    kind,
    paymentDate,
    effectiveDate,
    amount,
    currency: "XOF",
    paymentMethod:
      kind === "refund"
        ? oneOf(a.paymentMethod, ["cash", "check", "bank_transfer", "other"] as const)
        : oneOf(a.paymentMethod, ["offset"] as const),
    reason: text(a.reason, 1000),
    recordedBy: parseCimacRequestId(a.recordedBy),
    auditId: parseCimacRequestId(a.auditId),
    receiptNo: a.receiptNo === null ? null : text(a.receiptNo, 200),
    createdAt: timestamp(a.createdAt),
    allocations,
  };
}

/** Full historical chain, not just a reassuring remaining total or a boolean capability. */
export function decodeCimacCollectionPosition(
  value: unknown,
  originalPaymentId: string,
): CimacCollectionPosition {
  const row = object(value),
    original = parseCimacRequestId(originalPaymentId);
  if (
    row.originalPaymentId !== original ||
    row.currency !== "XOF" ||
    typeof row.canRefund !== "boolean" ||
    typeof row.canReverse !== "boolean" ||
    !Array.isArray(row.allocations) ||
    !row.allocations.length ||
    row.allocations.length > 100 ||
    !Array.isArray(row.adjustments) ||
    row.adjustments.length > 10000
  )
    throw invalid();
  const originalAmount = xof(row.originalAmount, true),
    refundedAmount = xof(row.refundedAmount),
    reversedAmount = xof(row.reversedAmount),
    remainingAmount = xof(row.remainingAmount);
  if (
    minor(originalAmount) !==
      minor(refundedAmount) + minor(reversedAmount) + minor(remainingAmount) ||
    (minor(reversedAmount) > BigInt(0) &&
      (reversedAmount !== originalAmount || refundedAmount !== "0")) ||
    (row.canReverse &&
      (remainingAmount !== originalAmount || refundedAmount !== "0" || reversedAmount !== "0")) ||
    (row.canRefund && (remainingAmount === "0" || reversedAmount !== "0"))
  )
    throw invalid();
  const originalPaymentDate = date(row.originalPaymentDate);
  if (originalPaymentDate > new Date().toISOString().slice(0, 10)) throw invalid();
  const allocations = row.allocations.map((raw) => {
    const a = object(raw),
      originalAmount = xof(a.originalAmount, true),
      refundedAmount = xof(a.refundedAmount),
      reversedAmount = xof(a.reversedAmount),
      remainingAmount = xof(a.remainingAmount),
      paidAmount = decimal(a.paidAmount, 2);
    if (
      minor(originalAmount) !==
        minor(refundedAmount) + minor(reversedAmount) + minor(remainingAmount) ||
      ((row.canRefund || row.canReverse) && minor(paidAmount) < minor(remainingAmount))
    )
      throw invalid();
    return {
      receivableId: parseCimacRequestId(a.receivableId),
      contractId: parseCimacRequestId(a.contractId),
      unitId: parseCimacRequestId(a.unitId),
      title: text(a.title, 1000),
      originalAmount,
      refundedAmount,
      reversedAmount,
      remainingAmount,
      paidAmount,
      updatedAt: timestamp(a.updatedAt),
    };
  });
  if (new Set(allocations.map((a) => a.receivableId)).size !== allocations.length) throw invalid();
  for (const [key, expected] of Object.entries({
    originalAmount,
    refundedAmount,
    reversedAmount,
    remainingAmount,
  }))
    if (
      allocations.reduce((sum, a) => sum + minor(a[key as "originalAmount"]), BigInt(0)) !==
      minor(expected)
    )
      throw invalid();
  const targets = new Map(allocations.map((a) => [a.receivableId, a]));
  const adjustments: CimacCollectionAdjustment[] = row.adjustments.map((raw) => {
    const a = decodeCimacCollectionAdjustment(raw),
      { kind, amount, paymentDate, effectiveDate } = a;
    if (
      a.originalPaymentId !== original ||
      a.currency !== "XOF" ||
      paymentDate < originalPaymentDate ||
      (kind === "refund"
        ? effectiveDate !== paymentDate
        : effectiveDate !== originalPaymentDate || paymentDate !== originalPaymentDate) ||
      !Array.isArray(a.allocations) ||
      !a.allocations.length ||
      a.allocations.length > 100
    )
      throw invalid();
    const links = a.allocations.map((raw) => {
      const link = raw,
        receivableId = parseCimacRequestId(link.receivableId);
      if (!targets.has(receivableId)) throw invalid();
      return { receivableId, amount: xof(link.amount, true) };
    });
    if (
      new Set(links.map((l) => l.receivableId)).size !== links.length ||
      links.reduce((sum, l) => sum + minor(l.amount), BigInt(0)) !== minor(amount)
    )
      throw invalid();
    return {
      id: parseCimacRequestId(a.id),
      requestId: parseCimacRequestId(a.requestId),
      paymentId: parseCimacRequestId(a.paymentId),
      originalPaymentId: original,
      kind,
      paymentDate,
      effectiveDate,
      amount,
      currency: "XOF",
      paymentMethod:
        kind === "refund"
          ? oneOf(a.paymentMethod, ["cash", "check", "bank_transfer", "other"])
          : oneOf(a.paymentMethod, ["offset"]),
      reason: text(a.reason, 1000),
      recordedBy: parseCimacRequestId(a.recordedBy),
      auditId: parseCimacRequestId(a.auditId),
      receiptNo: a.receiptNo === null ? null : text(a.receiptNo, 200),
      createdAt: timestamp(a.createdAt),
      allocations: links,
    };
  });
  for (const key of ["id", "requestId", "paymentId", "auditId"] as const)
    if (new Set(adjustments.map((a) => a[key])).size !== adjustments.length) throw invalid();
  if (adjustments.some((a) => a.paymentId === original)) throw invalid();
  for (const kind of ["refund", "reversal"] as const) {
    const key = kind === "refund" ? "refundedAmount" : "reversedAmount";
    if (
      adjustments
        .filter((a) => a.kind === kind)
        .reduce((sum, a) => sum + minor(a.amount), BigInt(0)) !== minor(row[key] as string)
    )
      throw invalid();
    for (const target of allocations)
      if (
        adjustments
          .filter((a) => a.kind === kind)
          .flatMap((a) => a.allocations)
          .filter((a) => a.receivableId === target.receivableId)
          .reduce((sum, a) => sum + minor(a.amount), BigInt(0)) !== minor(target[key])
      )
        throw invalid();
  }
  return {
    originalPaymentId: original,
    customerId: parseCimacRequestId(row.customerId),
    currency: "XOF",
    originalPaymentDate,
    originalPaymentMethod: oneOf(row.originalPaymentMethod, [
      "cash",
      "check",
      "bank_transfer",
      "other",
    ]),
    originalReceiptNo: row.originalReceiptNo === null ? null : text(row.originalReceiptNo, 200),
    originalAmount,
    refundedAmount,
    reversedAmount,
    remainingAmount,
    positionToken: positionToken(row.positionToken),
    canRefund: row.canRefund,
    canReverse: row.canReverse,
    allocations,
    adjustments,
  };
}

export function parseCimacCollectionInput(value: unknown): CimacRequestInput<CimacCollectionInput> {
  const input = object(value);
  keys(input, [
    "requestId",
    "customerId",
    "paymentDate",
    "currency",
    "amount",
    "paymentMethod",
    "externalReceiptNo",
    "actualCollector",
    "collectorBasis",
    "notes",
    "allocations",
  ]);
  const paymentDate = date(input.paymentDate);
  if (paymentDate > new Date().toISOString().slice(0, 10)) throw invalid();
  const amount = xof(input.amount, true);
  if (
    !Array.isArray(input.allocations) ||
    !input.allocations.length ||
    input.allocations.length > 100
  )
    throw invalid();
  const allocations = input.allocations.map((raw) => {
    const row = object(raw);
    keys(row, ["receivableId", "amount", "expectedOutstanding", "expectedUpdatedAt"]);
    const allocated = xof(row.amount, true);
    // The new receipt must be an integer XOF amount, but a historical balance
    // snapshot may contain cents. Preserve that exact balance rather than round it.
    const expectedOutstanding = decimal(row.expectedOutstanding, 2, true);
    if (minor(allocated) > minor(expectedOutstanding)) throw invalid();
    return {
      receivableId: parseCimacRequestId(row.receivableId),
      amount: allocated,
      expectedOutstanding,
      expectedUpdatedAt: timestamp(row.expectedUpdatedAt),
    };
  });
  if (
    new Set(allocations.map((row) => row.receivableId)).size !== allocations.length ||
    allocations.reduce((sum, row) => sum + minor(row.amount), BigInt(0)) !== minor(amount)
  )
    throw invalid();
  const actualCollector = optionalText(input.actualCollector, 100);
  const collectorBasis = optionalText(input.collectorBasis, 1000);
  if (!!actualCollector !== !!collectorBasis) throw invalid();
  const externalReceiptNo = optionalText(input.externalReceiptNo, 200);
  const notes = optionalText(input.notes, 2000);
  return {
    requestId: parseCimacRequestId(input.requestId),
    customerId: parseCimacRequestId(input.customerId),
    currency: oneOf(input.currency, ["XOF"]),
    paymentDate,
    amount,
    paymentMethod: oneOf(input.paymentMethod, ["cash", "check", "bank_transfer", "other"]),
    allocations,
    ...(actualCollector ? { actualCollector, collectorBasis } : {}),
    ...(externalReceiptNo ? { externalReceiptNo } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function parseCimacFeeTermInput(value: unknown): CimacRequestInput<CimacFeeTermInput> {
  const input = object(value);
  keys(input, [
    "requestId",
    "id",
    "customerId",
    "contractId",
    "unitId",
    "category",
    "currency",
    "monthlyRate",
    "pricingBasis",
    "chargeableArea",
    "startsOn",
    "endsOn",
    "annualStartsOn",
    "annualEndsOn",
    "proration",
    "source",
    "notes",
    "expectedUpdatedAt",
  ]);
  const monthlyRate = optionalDecimal(input.monthlyRate, 2, true);
  const chargeableArea = optionalDecimal(input.chargeableArea, 3, true);
  const startsOn = optionalDate(input.startsOn),
    endsOn = optionalDate(input.endsOn);
  const annualStartsOn = optionalDate(input.annualStartsOn),
    annualEndsOn = optionalDate(input.annualEndsOn);
  if (
    (startsOn && endsOn && startsOn > endsOn) ||
    (annualStartsOn && annualEndsOn && annualStartsOn > annualEndsOn)
  )
    throw invalid();
  const notes = optionalText(input.notes, 2000);
  return {
    requestId: parseCimacRequestId(input.requestId),
    customerId: parseCimacRequestId(input.customerId),
    contractId: parseCimacRequestId(input.contractId),
    unitId: parseCimacRequestId(input.unitId),
    ...revision(input),
    category: oneOf(input.category, categories),
    currency: oneOf(input.currency, currencies),
    pricingBasis: oneOf(input.pricingBasis, ["per_sqm", "per_unit", "pending"]),
    proration: oneOf(input.proration, ["daily_pending_convention", "pending"]),
    source: text(input.source, 1000),
    ...(monthlyRate === undefined ? {} : { monthlyRate }),
    ...(chargeableArea === undefined ? {} : { chargeableArea }),
    ...(startsOn ? { startsOn } : {}),
    ...(endsOn ? { endsOn } : {}),
    ...(annualStartsOn ? { annualStartsOn } : {}),
    ...(annualEndsOn ? { annualEndsOn } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function parseCimacMeterReadingInput(
  value: unknown,
): CimacRequestInput<CimacMeterReadingInput> {
  const input = object(value);
  keys(input, [
    "requestId",
    "id",
    "customerId",
    "contractId",
    "unitId",
    "meterKind",
    "meterNo",
    "serviceMonth",
    "readOn",
    "previousReading",
    "currentReading",
    "evidence",
    "notes",
    "expectedUpdatedAt",
  ]);
  const serviceMonth = date(input.serviceMonth);
  if (!serviceMonth.endsWith("-01")) throw invalid();
  const readOn = date(input.readOn);
  if (readOn > new Date().toISOString().slice(0, 10) || readOn < serviceMonth) throw invalid();
  const previousReading = optionalDecimal(input.previousReading, 3);
  const currentReading = decimal(input.currentReading, 3);
  if (previousReading !== undefined && minor(currentReading, 3) < minor(previousReading, 3))
    throw invalid();
  const evidence = optionalText(input.evidence, 2000),
    notes = optionalText(input.notes, 2000);
  return {
    requestId: parseCimacRequestId(input.requestId),
    customerId: parseCimacRequestId(input.customerId),
    contractId: parseCimacRequestId(input.contractId),
    unitId: parseCimacRequestId(input.unitId),
    ...revision(input),
    meterKind: oneOf(input.meterKind, ["water", "electricity"]),
    meterNo: text(input.meterNo, 100),
    serviceMonth,
    readOn,
    currentReading,
    ...(previousReading === undefined ? {} : { previousReading }),
    ...(evidence ? { evidence } : {}),
    ...(notes ? { notes } : {}),
  };
}

function decodeFeeTerm(value: unknown): CimacFeeTerm {
  const row = object(value);
  if (
    row.status !== "pending_review" ||
    [
      "monthlyRate",
      "chargeableArea",
      "startsOn",
      "endsOn",
      "annualStartsOn",
      "annualEndsOn",
      "notes",
    ].some((key) => row[key] === undefined)
  )
    throw invalid();
  const input = parseCimacFeeTermInput({
    requestId: row.id,
    id: row.id,
    customerId: row.customerId,
    contractId: row.contractId,
    unitId: row.unitId,
    category: row.category,
    currency: row.currency,
    monthlyRate: row.monthlyRate,
    pricingBasis: row.pricingBasis,
    chargeableArea: row.chargeableArea,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    annualStartsOn: row.annualStartsOn,
    annualEndsOn: row.annualEndsOn,
    proration: row.proration,
    source: row.source,
    notes: row.notes,
    expectedUpdatedAt: row.updatedAt,
  });
  return {
    id: input.id!,
    customerId: input.customerId,
    contractId: input.contractId,
    unitId: input.unitId,
    category: input.category,
    currency: input.currency,
    monthlyRate: input.monthlyRate ?? null,
    pricingBasis: input.pricingBasis,
    chargeableArea: input.chargeableArea ?? null,
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
    annualStartsOn: input.annualStartsOn ?? null,
    annualEndsOn: input.annualEndsOn ?? null,
    proration: input.proration,
    source: input.source,
    notes: input.notes ?? null,
    status: "pending_review",
    updatedAt: input.expectedUpdatedAt!,
    createdAt: timestamp(row.createdAt),
    recordedBy: parseCimacRequestId(row.recordedBy),
  };
}

function decodeMeterReading(value: unknown): CimacMeterReading {
  const row = object(value);
  if (
    row.status !== "recorded_pending_rate" ||
    ["previousReading", "usage", "evidence", "notes"].some((key) => row[key] === undefined)
  )
    throw invalid();
  const input = parseCimacMeterReadingInput({
    requestId: row.id,
    id: row.id,
    customerId: row.customerId,
    contractId: row.contractId,
    unitId: row.unitId,
    meterKind: row.meterKind,
    meterNo: row.meterNo,
    serviceMonth: row.serviceMonth,
    readOn: row.readOn,
    previousReading: row.previousReading,
    currentReading: row.currentReading,
    evidence: row.evidence,
    notes: row.notes,
    expectedUpdatedAt: row.updatedAt,
  });
  const usage = row.usage === null ? null : decimal(row.usage, 3);
  if (
    input.previousReading == null
      ? usage !== null
      : usage === null ||
        minor(usage, 3) !== minor(input.currentReading, 3) - minor(input.previousReading, 3)
  )
    throw invalid();
  return {
    id: input.id!,
    customerId: input.customerId,
    contractId: input.contractId,
    unitId: input.unitId,
    meterKind: input.meterKind,
    meterNo: input.meterNo,
    serviceMonth: input.serviceMonth,
    readOn: input.readOn,
    previousReading: input.previousReading ?? null,
    currentReading: input.currentReading,
    usage,
    evidence: input.evidence ?? null,
    notes: input.notes ?? null,
    status: "recorded_pending_rate",
    updatedAt: input.expectedUpdatedAt!,
    createdAt: timestamp(row.createdAt),
    recordedBy: parseCimacRequestId(row.recordedBy),
  };
}

/** A receipt is proof only after checking identities, money and operation-specific facts. */
export function decodeCimacWriteReceipt(
  value: unknown,
  requestId: string,
): CimacBillingWriteResult {
  const row = object(value);
  if (
    row.success !== true ||
    row.status !== "completed" ||
    row.requestId !== parseCimacRequestId(requestId) ||
    typeof row.idempotent !== "boolean"
  )
    throw invalid();
  const kind = oneOf(row.kind, ["collection", "fee_terms", "meter_reading", "refund", "reversal"]);
  const result: CimacBillingWriteResult = {
    success: true,
    status: "completed",
    kind,
    requestId: parseCimacRequestId(row.requestId),
    actorId: parseCimacRequestId(row.actorId),
    customerId: parseCimacRequestId(row.customerId),
    entityId: parseCimacRequestId(row.entityId),
    auditId: parseCimacRequestId(row.auditId),
    idempotent: row.idempotent,
  };
  if (kind === "collection" || kind === "refund" || kind === "reversal") {
    const paymentId = parseCimacRequestId(row.paymentId),
      amount = xof(row.amount, true);
    if (
      paymentId !== result.entityId ||
      row.currency !== "XOF" ||
      !Array.isArray(row.allocations) ||
      !row.allocations.length ||
      row.allocations.length > 100
    )
      throw invalid();
    const allocations = row.allocations.map((raw) => {
      const item = object(raw);
      if (item.currency !== "XOF" || parseCimacRequestId(item.paymentId) !== paymentId)
        throw invalid();
      return {
        paymentId,
        receivableId: parseCimacRequestId(item.receivableId),
        currency: "XOF" as const,
        amount: xof(item.amount, true),
      };
    });
    if (
      new Set(allocations.map((a) => a.receivableId)).size !== allocations.length ||
      allocations.reduce((sum, a) => sum + minor(a.amount), BigInt(0)) !== minor(amount)
    )
      throw invalid();
    const paymentResult: CimacBillingWriteResult = {
      ...result,
      paymentId,
      amount,
      currency: "XOF",
      allocations,
      receiptNo: row.receiptNo === null ? null : text(row.receiptNo, 200),
    };
    if (kind === "collection") return paymentResult;
    const originalPaymentId = parseCimacRequestId(row.originalPaymentId),
      remainingBefore = xof(row.remainingBefore, true),
      remainingAfter = xof(row.remainingAfter),
      paymentDate = date(row.paymentDate),
      effectiveDate = date(row.effectiveDate);
    if (
      originalPaymentId === paymentId ||
      minor(remainingBefore) - minor(amount) !== minor(remainingAfter) ||
      (kind === "reversal" && remainingAfter !== "0") ||
      paymentDate !== effectiveDate ||
      paymentDate > new Date().toISOString().slice(0, 10)
    )
      throw invalid();
    return {
      ...paymentResult,
      originalPaymentId,
      remainingBefore,
      remainingAfter,
      paymentDate,
      effectiveDate,
      paymentMethod:
        kind === "refund"
          ? oneOf(row.paymentMethod, ["cash", "check", "bank_transfer", "other"] as const)
          : oneOf(row.paymentMethod, ["offset"] as const),
    };
  }
  const record = kind === "fee_terms" ? decodeFeeTerm(row.record) : decodeMeterReading(row.record);
  if (
    record.id !== result.entityId ||
    record.customerId !== result.customerId ||
    record.recordedBy !== result.actorId
  )
    throw invalid();
  return { ...result, record };
}

/** Malformed or mismatched success must remain unknown: the transaction may have committed. */
export function decodeCimacWriteResult(
  value: unknown,
  input: CimacRequestInput<
    | CimacCollectionInput
    | CimacFeeTermInput
    | CimacMeterReadingInput
    | CimacRefundInput
    | CimacReversalInput
  >,
  kind: CimacBillingWriteKind,
  actorId: string,
): CimacBillingWriteResult {
  const result = decodeCimacWriteReceipt(value, input.requestId);
  if (
    result.kind !== kind ||
    result.customerId !== input.customerId ||
    result.actorId !== parseCimacRequestId(actorId)
  )
    throw invalid();
  if (kind === "collection" || kind === "refund" || kind === "reversal") {
    const expected = input as CimacRequestInput<
      CimacCollectionInput | CimacRefundInput | CimacReversalInput
    >;
    if (
      result.amount !== expected.amount ||
      result.currency !== expected.currency ||
      result.allocations?.length !== expected.allocations.length
    )
      throw invalid();
    const amounts = new Map(expected.allocations.map((a) => [a.receivableId, a.amount]));
    if (!result.allocations.every((a) => amounts.get(a.receivableId) === a.amount)) throw invalid();
    if (kind === "refund" || kind === "reversal") {
      const adjustment = expected as CimacRequestInput<CimacRefundInput | CimacReversalInput>;
      if (result.originalPaymentId !== adjustment.originalPaymentId) throw invalid();
      if (kind === "refund") {
        const refund = expected as CimacRequestInput<CimacRefundInput>;
        if (
          result.paymentDate !== refund.paymentDate ||
          result.effectiveDate !== refund.paymentDate ||
          result.paymentMethod !== refund.paymentMethod
        )
          throw invalid();
      } else if (result.remainingBefore !== adjustment.amount || result.remainingAfter !== "0")
        throw invalid();
    }
    return result;
  }
  const record = result.record!;
  const {
    requestId: _requestId,
    expectedUpdatedAt: _expectedUpdatedAt,
    ...expected
  } = input as CimacRequestInput<CimacFeeTermInput | CimacMeterReadingInput>;
  const nullable =
    kind === "fee_terms"
      ? [
          "monthlyRate",
          "chargeableArea",
          "startsOn",
          "endsOn",
          "annualStartsOn",
          "annualEndsOn",
          "notes",
        ]
      : ["previousReading", "evidence", "notes"];
  // Unknown inputs must remain unknown in the persisted record as well. A server
  // response that invents a start date or previous meter baseline is not proof.
  const projection = { ...Object.fromEntries(nullable.map((key) => [key, null])), ...expected };
  for (const [key, value] of Object.entries(projection))
    if (value !== (record as unknown as Record<string, unknown>)[key]) throw invalid();
  return result;
}
