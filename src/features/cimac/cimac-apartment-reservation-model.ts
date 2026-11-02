export type CimacApartmentReservationOperation = "reserve" | "cancel" | "correct_name";

export interface CimacApartmentReservation {
  id: string;
  reserverName: string;
  status: "reserved" | "cancelled";
  paymentStatus: "unpaid";
  updatedAt: string;
}

export interface CimacApartmentReservationMutation {
  type: CimacApartmentReservationOperation;
  unitId: string;
  expectedUnitUpdatedAt: string;
  expectedReservationId: string | null;
  expectedReservationUpdatedAt: string | null;
  reserverName: string | null;
  reason: string;
}

export interface CimacApartmentReservationRequest {
  requestId: string;
  originalInstruction: string;
  operations: CimacApartmentReservationMutation[];
}

export interface CimacApartmentReservationResultRoom {
  unitId: string;
  unitNo: string;
  reservationId: string;
  status: "reserved" | "cancelled";
  reserverName: string;
  paymentStatus: "unpaid";
  updatedAt: string;
}

export type CimacApartmentReservationActionResult =
  | { success: false; error: string; outcome?: "rejected" | "unknown" }
  | {
      success: true;
      requestId: string;
      idempotent: boolean;
      rooms: CimacApartmentReservationResultRoom[];
    };

export class CimacApartmentReservationError extends Error {
  constructor(
    public code = "apartment_reservation_unavailable",
    public status = 503,
  ) {
    super(code);
  }
}

export const apartmentUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const apartmentObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const apartmentTimestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 40 &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);

const only = (object: Record<string, unknown>, keys: string[]) =>
  Object.keys(object).length === keys.length && keys.every((key) => Object.hasOwn(object, key));
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= limit &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const invalid = (): never => {
  throw new CimacApartmentReservationError("invalid_apartment_reservation", 400);
};

/** These operations are unpaid, undated room holds. No date, money or occupancy fields are accepted. */
export function parseCimacApartmentReservationRequest(
  raw: unknown,
): CimacApartmentReservationRequest {
  if (
    !apartmentObject(raw) ||
    !only(raw, ["requestId", "originalInstruction", "operations"]) ||
    !apartmentUuid(raw.requestId) ||
    !text(raw.originalInstruction, 4000) ||
    !Array.isArray(raw.operations) ||
    !raw.operations.length ||
    raw.operations.length > 64
  )
    return invalid();
  const seen = new Set<string>();
  const operations = raw.operations.map((value): CimacApartmentReservationMutation => {
    if (
      !apartmentObject(value) ||
      !only(value, [
        "type",
        "unitId",
        "expectedUnitUpdatedAt",
        "expectedReservationId",
        "expectedReservationUpdatedAt",
        "reserverName",
        "reason",
      ]) ||
      !["reserve", "cancel", "correct_name"].includes(String(value.type)) ||
      !apartmentUuid(value.unitId) ||
      !apartmentTimestamp(value.expectedUnitUpdatedAt) ||
      !text(value.reason, 2000)
    )
      return invalid();
    const unitId = value.unitId.toLowerCase();
    if (seen.has(unitId)) return invalid();
    seen.add(unitId);
    if (
      value.type === "reserve"
        ? value.expectedReservationId !== null || value.expectedReservationUpdatedAt !== null
        : !apartmentUuid(value.expectedReservationId) ||
          !apartmentTimestamp(value.expectedReservationUpdatedAt)
    )
      return invalid();
    if (
      value.type === "cancel"
        ? value.reserverName !== null
        : !text(value.reserverName, 200) || /[\u0000-\u001f\u007f]/.test(value.reserverName)
    )
      return invalid();
    return {
      type: value.type as CimacApartmentReservationOperation,
      unitId,
      expectedUnitUpdatedAt: value.expectedUnitUpdatedAt,
      expectedReservationId:
        value.expectedReservationId === null
          ? null
          : String(value.expectedReservationId).toLowerCase(),
      expectedReservationUpdatedAt: value.expectedReservationUpdatedAt as string | null,
      reserverName: value.reserverName === null ? null : String(value.reserverName).trim(),
      reason: value.reason.trim(),
    };
  });
  return {
    requestId: raw.requestId.toLowerCase(),
    originalInstruction: raw.originalInstruction.trim(),
    operations,
  };
}
