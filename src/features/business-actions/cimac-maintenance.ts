/** Typed, allow-listed maintenance commands. No caller-selected tables, SQL or columns. */
export interface CimacReceipt {
  amount: string;
  currency: "CNY" | "XOF";
  paymentDate: string;
  paymentMethod: "cash" | "bank_transfer";
}
export interface CimacNoteReceipt extends CimacReceipt {
  contractId: string;
  noteMarker: string;
}
export interface CimacRefund extends CimacReceipt {
  originalPaymentIds: string[];
}
type Contracts = { contractIds: string[]; customerName: string; annotation: string };
type ReservationTerms = { monthlyRentXof: string; depositXof: string };
export type CimacMaintenanceOperation =
  | (Contracts &
      ReservationTerms & {
        type: "terms";
        freeMonths: number;
        rentFreeStart: string;
        rentFreeEnd: string;
        propertyRateXofPerSqm: string;
      })
  | (Contracts & {
      type: "close";
      correctedCustomerName?: string;
      refund: CimacRefund;
      noteReceipt?: CimacNoteReceipt;
    })
  | (Contracts &
      ReservationTerms & {
        type: "replace";
        refund: CimacRefund;
        newCustomerName: string;
        receipt: CimacReceipt;
      })
  | {
      type: "reserve";
      unitNos: string[];
      customerName: string;
      groupMonthlyRentXof: string;
      groupDepositXof: string;
      annotation: string;
    }
  | {
      type: "area";
      unitNo: string;
      customerName: string;
      areaSqm: string;
      propertyRateXofPerSqm: string;
      annotation: string;
    }
  | (ReservationTerms & {
      type: "create_reservation";
      buildingCode: string;
      unitNo: string;
      customerName: string;
      areaSqm: string;
      propertyRateXofPerSqm: string;
      annotation: string;
    })
  | (Contracts & { type: "note_receipt"; receipt: CimacNoteReceipt });

export interface CimacMaintenanceRequest {
  protocolVersion: "1.0";
  connectorVersion: "0.8.0";
  requestId: string;
  originalInstruction: string;
  inputSource: "natural_language" | "excel_screenshot";
  operations: CimacMaintenanceOperation[];
}

export class CimacMaintenanceFailure extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const invalid = () => new CimacMaintenanceFailure("invalidCimacMaintenance");
export function cimacObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function cimacOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
export function cimacUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
function id(value: unknown): string {
  if (!cimacUuid(value)) throw invalid();
  return value.toLowerCase();
}
function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw invalid();
  return value.trim();
}
export function cimacDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
/** Decimal strings only: prevent IEEE rounding and accidental ten-thousand units. */
export function cimacMoney(value: unknown, currency: "CNY" | "XOF", allowZero = false): string {
  if (
    typeof value !== "string" ||
    !(currency === "XOF" ? /^(0|[1-9]\d{0,11})$/ : /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/).test(value)
  )
    throw invalid();
  const [whole, fraction = ""] = value.split(".");
  if (!allowZero && BigInt(whole) === BigInt(0) && !/[1-9]/.test(fraction)) throw invalid();
  return currency === "XOF" ? whole : `${whole}.${fraction.padEnd(2, "0")}`;
}
function ids(value: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length > 30 || (!allowEmpty && !value.length)) throw invalid();
  const result = value.map(id);
  if (new Set(result).size !== result.length) throw invalid();
  return result;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 30) throw invalid();
  const result = value.map(unitNo);
  if (new Set(result).size !== result.length) throw invalid();
  return result;
}
function unitNo(value: unknown): string {
  const result = text(value, 20);
  if (!/^\d{3,4}$/.test(result)) throw invalid();
  return result;
}
function area(value: unknown): string {
  const result = cimacMoney(value, "CNY");
  if (BigInt(result.replace(".", "")) > BigInt("9999999999")) throw invalid();
  return result;
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!cimacObject(value) || !cimacOnlyKeys(value, keys)) throw invalid();
  return value;
}
function receipt(
  value: unknown,
  currency: "CNY" | "XOF",
  today: string,
  extra: string[] = [],
): CimacReceipt {
  const row = record(value, ["amount", "currency", "paymentDate", "paymentMethod", ...extra]);
  if (
    row.currency !== currency ||
    !cimacDate(row.paymentDate) ||
    row.paymentDate > today ||
    row.paymentMethod !== (currency === "XOF" ? "cash" : "bank_transfer")
  )
    throw invalid();
  return {
    amount: cimacMoney(row.amount, currency),
    currency,
    paymentDate: row.paymentDate,
    paymentMethod: row.paymentMethod as CimacReceipt["paymentMethod"],
  };
}
function noteReceipt(value: unknown, today: string): CimacNoteReceipt {
  const base = receipt(value, "CNY", today, ["contractId", "noteMarker"]);
  const row = value as Record<string, unknown>;
  return { ...base, contractId: id(row.contractId), noteMarker: text(row.noteMarker, 1000) };
}
function refund(value: unknown, today: string): CimacRefund {
  const base = receipt(value, "CNY", today, ["originalPaymentIds"]);
  return {
    ...base,
    originalPaymentIds: ids((value as Record<string, unknown>).originalPaymentIds, true),
  };
}
function reservationTerms(row: Record<string, unknown>) {
  const result = {
    monthlyRentXof: cimacMoney(row.monthlyRentXof, "XOF"),
    depositXof: cimacMoney(row.depositXof, "XOF"),
  };
  if (BigInt(result.depositXof) !== BigInt(result.monthlyRentXof) * BigInt(3)) throw invalid();
  return result;
}
function operation(value: unknown, today: string): CimacMaintenanceOperation {
  if (!cimacObject(value)) throw invalid();
  const common = ["type", "customerName", "annotation"];
  const base = () => ({
    customerName: text(value.customerName, 200),
    annotation: text(value.annotation, 2000),
  });
  const contracts = () => ({ ...base(), contractIds: ids(value.contractIds) });
  const terms = ["monthlyRentXof", "depositXof"];
  const rate = () => {
    const result = cimacMoney(value.propertyRateXofPerSqm, "XOF");
    if (result !== "900") throw invalid();
    return result;
  };
  switch (value.type) {
    case "terms": {
      record(value, [
        ...common,
        "contractIds",
        ...terms,
        "freeMonths",
        "rentFreeStart",
        "rentFreeEnd",
        "propertyRateXofPerSqm",
      ]);
      if (
        value.freeMonths !== 12 ||
        value.rentFreeStart !== "2027-04-01" ||
        value.rentFreeEnd !== "2028-03-31"
      )
        throw invalid();
      return {
        type: "terms",
        ...contracts(),
        ...reservationTerms(value),
        freeMonths: Number(value.freeMonths),
        rentFreeStart: value.rentFreeStart,
        rentFreeEnd: value.rentFreeEnd,
        propertyRateXofPerSqm: rate(),
      };
    }
    case "close": {
      record(value, [...common, "contractIds", "correctedCustomerName", "refund", "noteReceipt"]);
      const result: Extract<CimacMaintenanceOperation, { type: "close" }> = {
        type: "close",
        ...contracts(),
        refund: refund(value.refund, today),
      };
      if (value.correctedCustomerName !== undefined)
        result.correctedCustomerName = text(value.correctedCustomerName, 200);
      if (value.noteReceipt !== undefined) {
        result.noteReceipt = noteReceipt(value.noteReceipt, today);
        if (
          !result.contractIds.includes(result.noteReceipt.contractId) ||
          result.noteReceipt.paymentDate > result.refund.paymentDate ||
          result.noteReceipt.amount !== result.refund.amount ||
          result.refund.originalPaymentIds.length !== 0
        )
          throw invalid();
      } else if (!result.refund.originalPaymentIds.length) throw invalid();
      return result;
    }
    case "replace": {
      record(value, [...common, "contractIds", ...terms, "refund", "newCustomerName", "receipt"]);
      const result = {
        type: "replace" as const,
        ...contracts(),
        ...reservationTerms(value),
        refund: refund(value.refund, today),
        newCustomerName: text(value.newCustomerName, 200),
        receipt: receipt(value.receipt, "XOF", today),
      };
      if (
        result.contractIds.length !== 1 ||
        !result.refund.originalPaymentIds.length ||
        result.newCustomerName === result.customerName ||
        result.receipt.amount !== result.depositXof
      )
        throw invalid();
      return result;
    }
    case "reserve": {
      record(value, [...common, "unitNos", "groupMonthlyRentXof", "groupDepositXof"]);
      const result = {
        type: "reserve" as const,
        ...base(),
        unitNos: strings(value.unitNos),
        groupMonthlyRentXof: cimacMoney(value.groupMonthlyRentXof, "XOF"),
        groupDepositXof: cimacMoney(value.groupDepositXof, "XOF"),
      };
      if (BigInt(result.groupDepositXof) !== BigInt(result.groupMonthlyRentXof) * BigInt(3))
        throw invalid();
      return result;
    }
    case "area":
      record(value, [...common, "unitNo", "areaSqm", "propertyRateXofPerSqm"]);
      return {
        type: "area",
        ...base(),
        unitNo: unitNo(value.unitNo),
        areaSqm: area(value.areaSqm),
        propertyRateXofPerSqm: rate(),
      };
    case "create_reservation": {
      record(value, [
        ...common,
        ...terms,
        "buildingCode",
        "unitNo",
        "areaSqm",
        "propertyRateXofPerSqm",
      ]);
      const number = unitNo(value.unitNo);
      const buildingCode = text(value.buildingCode, 80);
      if (buildingCode !== `CIMAC-B${number.slice(0, -2).padStart(2, "0")}`) throw invalid();
      return {
        type: "create_reservation",
        ...base(),
        ...reservationTerms(value),
        buildingCode,
        unitNo: number,
        areaSqm: area(value.areaSqm),
        propertyRateXofPerSqm: rate(),
      };
    }
    case "note_receipt": {
      record(value, [...common, "contractIds", "receipt"]);
      const result = {
        type: "note_receipt" as const,
        ...contracts(),
        receipt: noteReceipt(value.receipt, today),
      };
      if (result.contractIds.length !== 1 || result.receipt.contractId !== result.contractIds[0])
        throw invalid();
      return result;
    }
    default:
      throw invalid();
  }
}

export function parseCimacMaintenance(
  value: unknown,
  today = new Date().toISOString().slice(0, 10),
): CimacMaintenanceRequest {
  const row = record(value, [
    "protocolVersion",
    "connectorVersion",
    "requestId",
    "originalInstruction",
    "inputSource",
    "operations",
  ]);
  if (
    row.protocolVersion !== "1.0" ||
    row.connectorVersion !== "0.8.0" ||
    !["natural_language", "excel_screenshot"].includes(String(row.inputSource)) ||
    !Array.isArray(row.operations) ||
    !row.operations.length ||
    row.operations.length > 30
  )
    throw invalid();
  const operations = row.operations.map((item) => operation(item, today));
  const seen = new Set<string>();
  for (const op of operations) {
    const targets =
      "contractIds" in op
        ? op.contractIds.map((id) => `contract:${id}`)
        : (op.type === "reserve" ? op.unitNos : [op.unitNo]).map((number) => `unit:${number}`);
    for (const target of targets) {
      if (seen.has(target)) throw invalid();
      seen.add(target);
    }
  }
  return {
    protocolVersion: "1.0",
    connectorVersion: "0.8.0",
    requestId: id(row.requestId),
    originalInstruction: text(row.originalInstruction, 4000),
    inputSource: row.inputSource as CimacMaintenanceRequest["inputSource"],
    operations,
  };
}
