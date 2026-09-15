import {
  SACSI_OPERATOR_MIN_CONNECTOR_VERSION,
  SACSI_OPERATOR_PROTOCOL_VERSION,
} from "./operator-protocol";
import type {
  OperatorInputSource,
  OperatorRequestScope,
} from "./operator-execution-policy";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;
const INPUT_SOURCES = new Set<OperatorInputSource>([
  "natural_language",
  "manual_form",
  "excel_screenshot",
  "structured_batch",
]);

export type OperatorActionRequest = {
  protocolVersion: string;
  connectorVersion: string;
  requestId: string;
  actionName: string;
  inputSource: OperatorInputSource;
  scope: OperatorRequestScope;
  exceptionalBusinessCase: boolean;
  originalInstruction: string;
  input: Record<string, unknown>;
};

export type QueryDailyBookingInput =
  | { bookingId: string; buildingCode: null; unitNo: null }
  | { bookingId: null; buildingCode: string; unitNo: string };

export interface RecordDailyPaymentInput {
  bookingId: string;
  amountXof: number;
  paymentDate: string;
  receiptNo: string | null;
}

export interface RenewLeaseInput {
  contractId: string;
  newEndDate: string;
}

export type ContractResult<T> =
  | { success: true; data: T }
  | { success: false; code: string; error: string };

function fail(code: string, error: string): ContractResult<never> {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}

export function parseOperatorActionRequest(value: unknown): ContractResult<OperatorActionRequest> {
  if (!isRecord(value)) return fail("invalid_request", "Request body must be a JSON object");

  const protocolVersion = boundedString(value.protocolVersion, 20);
  const connectorVersion = boundedString(value.connectorVersion, 40);
  const requestId = boundedString(value.requestId, 36);
  const actionName = boundedString(value.actionName, 80);
  const originalInstruction = boundedString(value.originalInstruction, 4_000);
  const inputSource = value.inputSource;
  const scope = value.scope ?? "business_data";

  if (!protocolVersion || !connectorVersion || !requestId || !actionName || !originalInstruction) {
    return fail("invalid_request", "Protocol, connector, request, action and original instruction are required");
  }
  if (!UUID_PATTERN.test(requestId)) return fail("invalid_request_id", "requestId must be a UUID");
  if (!INPUT_SOURCES.has(inputSource as OperatorInputSource)) {
    return fail("invalid_input_source", "Unsupported inputSource");
  }
  if (scope !== "business_data" && scope !== "system_change") {
    return fail("invalid_scope", "Unsupported request scope");
  }
  if (!isRecord(value.input)) return fail("invalid_input", "input must be a JSON object");

  return {
    success: true,
    data: {
      protocolVersion,
      connectorVersion,
      requestId,
      actionName,
      originalInstruction,
      inputSource: inputSource as OperatorInputSource,
      scope,
      exceptionalBusinessCase: value.exceptionalBusinessCase === true,
      input: value.input,
    },
  };
}

export function validateOperatorCompatibility(input: Pick<OperatorActionRequest, "protocolVersion" | "connectorVersion">): ContractResult<true> {
  if (input.protocolVersion !== SACSI_OPERATOR_PROTOCOL_VERSION) {
    return fail("protocol_version_mismatch", `Server requires protocol ${SACSI_OPERATOR_PROTOCOL_VERSION}`);
  }

  const actual = VERSION_PATTERN.exec(input.connectorVersion);
  const minimum = VERSION_PATTERN.exec(SACSI_OPERATOR_MIN_CONNECTOR_VERSION);
  if (!actual || !minimum) return fail("invalid_connector_version", "connectorVersion must use semantic versioning");
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(actual[index]) - Number(minimum[index]);
    if (difference > 0) return { success: true, data: true };
    if (difference < 0) {
      return fail("connector_upgrade_required", `Connector ${SACSI_OPERATOR_MIN_CONNECTOR_VERSION} or newer is required`);
    }
  }
  return { success: true, data: true };
}

export function parseQueryDailyBookingInput(input: Record<string, unknown>): ContractResult<QueryDailyBookingInput> {
  const bookingId = boundedString(input.bookingId, 36);
  const buildingCode = boundedString(input.buildingCode, 40);
  const unitNo = boundedString(input.unitNo, 40);
  if (bookingId) {
    if (!UUID_PATTERN.test(bookingId)) return fail("invalid_booking_id", "bookingId must be a UUID");
    if (buildingCode || unitNo) return fail("selector_conflict", "Use bookingId or buildingCode plus unitNo, not both");
    return { success: true, data: { bookingId, buildingCode: null, unitNo: null } };
  }
  if (!buildingCode || !unitNo) {
    return fail("selector_required", "Provide bookingId or both buildingCode and unitNo");
  }
  return { success: true, data: { bookingId: null, buildingCode, unitNo } };
}

export function parseRecordDailyPaymentInput(input: Record<string, unknown>): ContractResult<RecordDailyPaymentInput> {
  const bookingId = boundedString(input.bookingId, 36);
  const paymentDate = boundedString(input.paymentDate, 10);
  const receiptNo = input.receiptNo == null ? null : boundedString(input.receiptNo, 120);
  const amountXof = input.amountXof;
  if (!bookingId || !UUID_PATTERN.test(bookingId)) return fail("invalid_booking_id", "bookingId must be a UUID");
  if (typeof amountXof !== "number" || !Number.isSafeInteger(amountXof) || amountXof <= 0) {
    return fail("invalid_payment_amount", "amountXof must be a positive integer");
  }
  const parsedDate = paymentDate ? new Date(`${paymentDate}T00:00:00Z`) : null;
  if (
    !paymentDate
    || !DATE_PATTERN.test(paymentDate)
    || !parsedDate
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== paymentDate
  ) {
    return fail("invalid_payment_date", "paymentDate must be a valid YYYY-MM-DD date");
  }
  if (input.receiptNo != null && !receiptNo) return fail("invalid_receipt_no", "receiptNo is too long or empty");
  return { success: true, data: { bookingId, amountXof, paymentDate, receiptNo } };
}

export function parseRenewLeaseInput(input: Record<string, unknown>): ContractResult<RenewLeaseInput> {
  const contractId = boundedString(input.contractId, 36);
  const newEndDate = boundedString(input.newEndDate, 10);
  if (!contractId || !UUID_PATTERN.test(contractId)) return fail("invalid_contract_id", "contractId must be a UUID");
  const parsedDate = newEndDate ? new Date(`${newEndDate}T00:00:00Z`) : null;
  if (!newEndDate || !DATE_PATTERN.test(newEndDate) || !parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== newEndDate) {
    return fail("invalid_end_date", "newEndDate must be a valid YYYY-MM-DD date");
  }
  return { success: true, data: { contractId, newEndDate } };
}
