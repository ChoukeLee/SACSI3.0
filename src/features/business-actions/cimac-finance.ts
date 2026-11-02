/** Bounded CIMAC finance completion input; no dynamic tables, fields or SQL. */
export interface CimacFinanceReceipt {
  amountXof: string;
  paymentDate: string;
  paymentMethod: "cash";
  externalReceiptNo?: string;
  sourceText: string;
}
type Annotated = { annotation: string };
export type CimacFinanceOperation =
  | (Annotated & {
      type: "collect";
      customerId: string;
      customerName: string;
      category: "lease_deposit" | "property_fee";
      receipt: CimacFinanceReceipt;
      parts: Array<{ contractId: string; amountXof: string; discountXof?: string }>;
      servicePeriod?: { start: string; end: string };
    })
  | (Annotated & {
      type: "new_deposit";
      customerName: string;
      receipt: CimacFinanceReceipt;
      units: Array<{
        unitNo: string;
        monthlyRentXof: string;
        depositXof: string;
        amountXof: string;
      }>;
    })
  | (Annotated & {
      type: "reclassify";
      paymentId: string;
      expectedSourceType: "lease_rent" | "lease_deposit";
      targetSourceType: "lease_rent" | "lease_deposit";
      amountCny: string;
    })
  | (Annotated & {
      type: "identity";
      customerId: string;
      customerName: string;
      units: Array<{ unitNo: string; expectedHolderName: string | null }>;
      holderName?: string;
      managementNames?: string[];
    });
export interface CimacFinanceRequest {
  protocolVersion: "1.0";
  connectorVersion: "0.9.0";
  requestId: string;
  originalInstruction: string;
  inputSource: "excel_screenshot";
  operations: CimacFinanceOperation[];
}
export class CimacFinanceFailure extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const invalid = (): never => {
  throw new CimacFinanceFailure("invalidCimacFinance");
};
export function cimacFinanceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function cimacFinanceOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
export function cimacFinanceUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
function id(value: unknown): string {
  if (!cimacFinanceUuid(value)) return invalid();
  return value.toLowerCase();
}
function object(value: unknown, keys: string[]) {
  if (!cimacFinanceObject(value) || !cimacFinanceOnlyKeys(value, keys)) return invalid();
  return value;
}
function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    return invalid();
  return value.trim();
}
export function cimacFinanceDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function cimacFinanceAnnualEnd(start: string): string {
  const [year, month, day] = start.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
  return new Date(Date.UTC(year + 1, month - 1, Math.min(day, lastDay)) - 86400000)
    .toISOString()
    .slice(0, 10);
}
/** Decimal strings only, with no implicit ten-thousand unit or currency conversion. */
export function cimacFinanceMoney(
  value: unknown,
  currency: "XOF" | "CNY",
  allowZero = false,
): string {
  if (
    typeof value !== "string" ||
    !(currency === "XOF" ? /^(0|[1-9]\d{0,11})$/ : /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/).test(value)
  )
    return invalid();
  const [whole, fraction = ""] = value.split(".");
  if (!allowZero && BigInt(whole) === BigInt(0) && !/[1-9]/.test(fraction)) return invalid();
  return currency === "XOF" ? whole : `${whole}.${fraction.padEnd(2, "0")}`;
}
function list(value: unknown, maximum = 30): unknown[] {
  if (!Array.isArray(value) || !value.length || value.length > maximum) return invalid();
  return value;
}
function unitNo(value: unknown): string {
  if (typeof value !== "string" || !/^\d{3,4}$/.test(value) || value === "231") return invalid();
  return value;
}
function receipt(value: unknown, today: string): CimacFinanceReceipt {
  const row = object(value, [
    "amountXof",
    "paymentDate",
    "paymentMethod",
    "externalReceiptNo",
    "sourceText",
  ]);
  if (!cimacFinanceDate(row.paymentDate) || row.paymentDate > today || row.paymentMethod !== "cash")
    return invalid();
  return {
    amountXof: cimacFinanceMoney(row.amountXof, "XOF"),
    paymentDate: row.paymentDate,
    paymentMethod: "cash",
    sourceText: text(row.sourceText, 2000),
    ...(row.externalReceiptNo === undefined
      ? {}
      : { externalReceiptNo: text(row.externalReceiptNo, 200) }),
  };
}
function sameTotal(values: string[], total: string) {
  if (values.reduce((sum, value) => sum + BigInt(value), BigInt(0)) !== BigInt(total))
    return invalid();
}
function operation(value: unknown, today: string): CimacFinanceOperation {
  if (!cimacFinanceObject(value)) return invalid();
  const annotation = text(value.annotation, 2000);
  switch (value.type) {
    case "collect": {
      const row = object(value, [
        "type",
        "customerId",
        "customerName",
        "category",
        "receipt",
        "parts",
        "servicePeriod",
        "annotation",
      ]);
      if (!["lease_deposit", "property_fee"].includes(String(row.category))) return invalid();
      const parts = list(row.parts, 100).map((raw) => {
        const part = object(raw, ["contractId", "amountXof", "discountXof"]);
        if (row.category === "lease_deposit" && part.discountXof !== undefined) return invalid();
        return {
          contractId: id(part.contractId),
          amountXof: cimacFinanceMoney(part.amountXof, "XOF"),
          ...(row.category === "property_fee"
            ? {
                discountXof: cimacFinanceMoney(
                  part.discountXof === undefined ? "0" : part.discountXof,
                  "XOF",
                  true,
                ),
              }
            : {}),
        };
      });
      const collected = receipt(row.receipt, today);
      sameTotal(
        parts.map((part) => part.amountXof),
        collected.amountXof,
      );
      const result: Extract<CimacFinanceOperation, { type: "collect" }> = {
        type: "collect",
        customerId: id(row.customerId),
        customerName: text(row.customerName, 200),
        category: row.category as "lease_deposit" | "property_fee",
        receipt: collected,
        parts,
        annotation,
      };
      if (row.category === "property_fee") {
        const period = object(row.servicePeriod, ["start", "end"]);
        if (
          !cimacFinanceDate(period.start) ||
          !cimacFinanceDate(period.end) ||
          period.end !== cimacFinanceAnnualEnd(period.start)
        )
          return invalid();
        result.servicePeriod = { start: period.start, end: period.end };
      } else if (row.servicePeriod !== undefined) return invalid();
      return result;
    }
    case "new_deposit": {
      const row = object(value, ["type", "customerName", "receipt", "units", "annotation"]);
      const units = list(row.units).map((raw) => {
        const unit = object(raw, ["unitNo", "monthlyRentXof", "depositXof", "amountXof"]);
        const monthlyRentXof = cimacFinanceMoney(unit.monthlyRentXof, "XOF"),
          depositXof = cimacFinanceMoney(unit.depositXof, "XOF"),
          amountXof = cimacFinanceMoney(unit.amountXof, "XOF");
        if (
          BigInt(depositXof) !== BigInt(monthlyRentXof) * BigInt(3) ||
          BigInt(amountXof) > BigInt(depositXof)
        )
          return invalid();
        return { unitNo: unitNo(unit.unitNo), monthlyRentXof, depositXof, amountXof };
      });
      const collected = receipt(row.receipt, today);
      sameTotal(
        units.map((unit) => unit.amountXof),
        collected.amountXof,
      );
      return {
        type: "new_deposit",
        customerName: text(row.customerName, 200),
        receipt: collected,
        units,
        annotation,
      };
    }
    case "reclassify": {
      const row = object(value, [
        "type",
        "paymentId",
        "expectedSourceType",
        "targetSourceType",
        "amountCny",
        "annotation",
      ]);
      if (
        !["lease_deposit", "lease_rent"].includes(String(row.expectedSourceType)) ||
        !["lease_deposit", "lease_rent"].includes(String(row.targetSourceType)) ||
        row.expectedSourceType === row.targetSourceType
      )
        return invalid();
      return {
        type: "reclassify",
        paymentId: id(row.paymentId),
        expectedSourceType: row.expectedSourceType as "lease_deposit" | "lease_rent",
        targetSourceType: row.targetSourceType as "lease_deposit" | "lease_rent",
        amountCny: cimacFinanceMoney(row.amountCny, "CNY"),
        annotation,
      };
    }
    case "identity": {
      const row = object(value, [
        "type",
        "customerId",
        "customerName",
        "units",
        "holderName",
        "managementNames",
        "annotation",
      ]);
      const result: Extract<CimacFinanceOperation, { type: "identity" }> = {
        type: "identity",
        customerId: id(row.customerId),
        customerName: text(row.customerName, 200),
        annotation,
        units: list(row.units).map((raw) => {
          const unit = object(raw, ["unitNo", "expectedHolderName"]);
          return {
            unitNo: unitNo(unit.unitNo),
            expectedHolderName:
              unit.expectedHolderName === null ? null : text(unit.expectedHolderName, 200),
          };
        }),
      };
      if (row.holderName !== undefined) {
        result.holderName = text(row.holderName, 200);
        if (result.holderName !== result.customerName) return invalid();
      }
      if (row.managementNames !== undefined) {
        if (
          !Array.isArray(row.managementNames) ||
          !row.managementNames.length ||
          row.managementNames.length > 10
        )
          return invalid();
        result.managementNames = row.managementNames.map((name) => text(name, 200));
        if (new Set(result.managementNames).size !== result.managementNames.length)
          return invalid();
      }
      if (!result.holderName && !result.managementNames) return invalid();
      return result;
    }
    default:
      return invalid();
  }
}
export function parseCimacFinance(
  value: unknown,
  today = new Date().toISOString().slice(0, 10),
): CimacFinanceRequest {
  const row = object(value, [
    "protocolVersion",
    "connectorVersion",
    "requestId",
    "originalInstruction",
    "inputSource",
    "operations",
  ]);
  if (
    row.protocolVersion !== "1.0" ||
    row.connectorVersion !== "0.9.0" ||
    row.inputSource !== "excel_screenshot" ||
    !cimacFinanceDate(today)
  )
    return invalid();
  const operations = list(row.operations).map((op) => operation(op, today));
  const contracts = new Set<string>(),
    payments = new Set<string>(),
    identityUnits = new Set<string>(),
    newUnits = new Set<string>(),
    newCustomerNames = new Set<string>();
  let partCount = 0;
  const unique = (set: Set<string>, key: string) => {
    if (set.has(key)) return invalid();
    set.add(key);
  };
  for (const op of operations) {
    if (op.type === "collect") {
      partCount += op.parts.length;
      for (const part of op.parts) unique(contracts, part.contractId);
    }
    if (op.type === "reclassify") {
      partCount++;
      unique(payments, op.paymentId);
    }
    if (op.type === "new_deposit") {
      unique(newCustomerNames, op.customerName.toLowerCase());
      partCount += op.units.length;
      for (const unit of op.units) unique(newUnits, unit.unitNo);
    }
    if (op.type === "identity") {
      partCount += op.units.length;
      for (const unit of op.units) unique(identityUnits, unit.unitNo);
    }
  }
  if (partCount > 100 || [...newUnits].some((no) => identityUnits.has(no))) return invalid();
  return {
    protocolVersion: "1.0",
    connectorVersion: "0.9.0",
    requestId: id(row.requestId),
    originalInstruction: text(row.originalInstruction, 4000),
    inputSource: "excel_screenshot",
    operations,
  };
}
