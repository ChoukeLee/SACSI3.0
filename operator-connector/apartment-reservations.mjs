// Standalone, fixed B17 reservation protocol. No dates, prices, occupancy or finance writes.
import { isDeepStrictEqual } from "node:util";

export const apartmentActions = ["reserve", "cancel", "correct_name"];
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const roomNumber = (value) => typeof value === "string" && /^[2-5](?:0[1-9]|1[0-6])$/.test(value);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys, optional = []) =>
  object(value) &&
  keys.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => keys.includes(key) || optional.includes(key));
const text = (value, max) =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
const noteText = (value, max) =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const stamp = (value) =>
  typeof value === "string" &&
  value.length <= 80 &&
  /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);
const invalid = () => {
  throw new Error("invalid_cimac_apartment_reservation_request");
};
const unverified = () => {
  throw new Error("apartment_reservation_verification_failed_keep_original_request_id");
};
const stateError = () => {
  throw new Error("apartment_reservation_state_requires_reconciliation");
};

export function normalizeApartmentReservationQuery(value) {
  if (!exact(value, [], ["unitNos"])) return invalid();
  if (value.unitNos === undefined) return {};
  if (
    !Array.isArray(value.unitNos) ||
    value.unitNos.length < 1 ||
    value.unitNos.length > 64 ||
    value.unitNos.some((number) => !roomNumber(number)) ||
    new Set(value.unitNos).size !== value.unitNos.length
  )
    return invalid();
  return { unitNos: [...value.unitNos] };
}

export function normalizeApartmentReservationStatus(value) {
  if (!exact(value, ["requestId"]) || !uuid(value.requestId)) return invalid();
  return { requestId: value.requestId.toLowerCase() };
}

export function normalizeApartmentReservationRequest(value) {
  if (
    !exact(value, ["requestId", "originalInstruction", "operations"]) ||
    !uuid(value.requestId) ||
    !noteText(value.originalInstruction, 4000) ||
    !Array.isArray(value.operations) ||
    value.operations.length < 1 ||
    value.operations.length > 64
  )
    return invalid();
  const seen = new Set();
  const operations = value.operations.map((op) => {
    if (
      !exact(op, [
        "type",
        "unitId",
        "expectedUnitUpdatedAt",
        "expectedReservationId",
        "expectedReservationUpdatedAt",
        "reserverName",
        "reason",
      ]) ||
      !apartmentActions.includes(op.type) ||
      !uuid(op.unitId) ||
      seen.has(op.unitId.toLowerCase()) ||
      !stamp(op.expectedUnitUpdatedAt) ||
      !noteText(op.reason, 2000)
    )
      return invalid();
    seen.add(op.unitId.toLowerCase());
    if (op.type === "reserve") {
      if (
        op.expectedReservationId !== null ||
        op.expectedReservationUpdatedAt !== null ||
        !text(op.reserverName, 200)
      )
        return invalid();
    } else if (
      !uuid(op.expectedReservationId) ||
      !stamp(op.expectedReservationUpdatedAt) ||
      (op.type === "cancel" ? op.reserverName !== null : !text(op.reserverName, 200))
    )
      return invalid();
    return {
      type: op.type,
      unitId: op.unitId.toLowerCase(),
      expectedUnitUpdatedAt: op.expectedUnitUpdatedAt,
      expectedReservationId:
        op.expectedReservationId === null ? null : op.expectedReservationId.toLowerCase(),
      expectedReservationUpdatedAt: op.expectedReservationUpdatedAt,
      reserverName: op.reserverName === null ? null : op.reserverName.trim(),
      reason: op.reason.trim(),
    };
  });
  return {
    requestId: value.requestId.toLowerCase(),
    originalInstruction: value.originalInstruction.trim(),
    operations,
  };
}

export function apartmentReservationFeatureAvailable(manifest, connectorVersion, write = true) {
  const feature = manifest?.cimacApartmentReservations;
  if (
    manifest?.identity?.role !== "admin" ||
    !feature ||
    typeof feature.available !== "boolean" ||
    (write && (manifest.directExecution?.available !== true || feature.available !== true)) ||
    feature.version !== 1 ||
    !Array.isArray(feature.actions) ||
    feature.actions.length !== 3 ||
    new Set(feature.actions).size !== 3 ||
    feature.actions.some((action) => !apartmentActions.includes(action)) ||
    !/^\d+\.\d+\.\d+$/.test(feature.minimumConnectorVersion ?? "")
  )
    return false;
  const actual = connectorVersion.split(".").map(Number),
    minimum = feature.minimumConnectorVersion.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (actual[i] > minimum[i]) return true;
    if (actual[i] < minimum[i]) return false;
  }
  return true;
}

export function verifyApartmentReservationQuery(value, query, actorId) {
  if (
    !exact(value, ["success", "actorId", "projectId", "buildingId", "schemaAvailable", "rooms"]) ||
    value.success !== true ||
    value.actorId !== actorId ||
    !uuid(value.projectId) ||
    !uuid(value.buildingId) ||
    typeof value.schemaAvailable !== "boolean" ||
    !Array.isArray(value.rooms) ||
    value.rooms.length > 64 ||
    (!value.schemaAvailable && value.rooms.length !== 0)
  )
    return unverified();
  const ids = new Set(),
    numbers = new Set(),
    reservations = new Set();
  for (const row of value.rooms) {
    if (
      !exact(row, ["unitId", "unitNo", "unitUpdatedAt", "reservation"]) ||
      !uuid(row.unitId) ||
      !roomNumber(row.unitNo) ||
      !stamp(row.unitUpdatedAt) ||
      ids.has(row.unitId.toLowerCase()) ||
      numbers.has(row.unitNo) ||
      (query.unitNos && !query.unitNos.includes(row.unitNo))
    )
      return unverified();
    ids.add(row.unitId.toLowerCase());
    numbers.add(row.unitNo);
    const r = row.reservation;
    if (r !== null) {
      if (
        !exact(r, ["id", "reserverName", "status", "paymentStatus", "updatedAt"]) ||
        !uuid(r.id) ||
        reservations.has(r.id.toLowerCase()) ||
        !text(r.reserverName, 200) ||
        r.status !== "reserved" ||
        r.paymentStatus !== "unpaid" ||
        !stamp(r.updatedAt)
      )
        return unverified();
      reservations.add(r.id.toLowerCase());
    }
  }
  if (value.schemaAvailable && query.unitNos && value.rooms.length !== query.unitNos.length)
    return unverified();
  return value;
}

export function assertApartmentReservationSnapshot(queryResult, request) {
  if (!queryResult.schemaAvailable) throw new Error("cimac_apartment_reservations_not_available");
  const rooms = new Map(queryResult.rooms.map((room) => [room.unitId, room]));
  for (const op of request.operations) {
    const room = rooms.get(op.unitId);
    if (
      !room ||
      room.unitUpdatedAt !== op.expectedUnitUpdatedAt ||
      (room.reservation?.id ?? null) !== op.expectedReservationId ||
      (room.reservation?.updatedAt ?? null) !== op.expectedReservationUpdatedAt ||
      (op.type === "reserve" ? room.reservation !== null : room.reservation === null)
    )
      return stateError();
  }
  return rooms;
}

function resultShape(value, request, actorId) {
  if (
    !exact(value, [
      "success",
      "requestId",
      "actorId",
      "projectId",
      "buildingId",
      "idempotent",
      "rooms",
    ]) ||
    value.success !== true ||
    value.requestId !== request.requestId ||
    value.actorId !== actorId ||
    !uuid(value.projectId) ||
    !uuid(value.buildingId) ||
    typeof value.idempotent !== "boolean" ||
    !Array.isArray(value.rooms) ||
    value.rooms.length !== request.operations.length
  )
    return unverified();
  const seen = new Set(),
    reservations = new Set();
  const operations = new Map(request.operations.map((op) => [op.unitId, op]));
  for (const row of value.rooms) {
    const op = operations.get(row?.unitId);
    if (
      !exact(row, [
        "unitId",
        "unitNo",
        "reservationId",
        "status",
        "reserverName",
        "paymentStatus",
        "updatedAt",
      ]) ||
      !op ||
      seen.has(row.unitId) ||
      !roomNumber(row.unitNo) ||
      !uuid(row.reservationId) ||
      reservations.has(row.reservationId.toLowerCase()) ||
      row.status !== (op.type === "cancel" ? "cancelled" : "reserved") ||
      row.paymentStatus !== "unpaid" ||
      !stamp(row.updatedAt) ||
      !text(row.reserverName, 200) ||
      (op.type !== "reserve" && row.reservationId !== op.expectedReservationId) ||
      (op.type !== "cancel" && row.reserverName !== op.reserverName)
    )
      return unverified();
    seen.add(row.unitId);
    reservations.add(row.reservationId.toLowerCase());
  }
  return value;
}

export function verifyApartmentReservationResult(value, request, actorId, snapshot) {
  resultShape(value, request, actorId);
  if (value.projectId !== snapshot.projectId || value.buildingId !== snapshot.buildingId)
    return unverified();
  const before = new Map(snapshot.rooms.map((room) => [room.unitId, room]));
  for (const row of value.rooms) {
    const prior = before.get(row.unitId);
    const op = request.operations.find((item) => item.unitId === row.unitId);
    if (
      !prior ||
      row.unitNo !== prior.unitNo ||
      (op.type === "cancel" && row.reserverName !== prior.reservation?.reserverName)
    )
      return unverified();
  }
  return value;
}

export function verifyApartmentReservationHistory(value, requestId, actorId, expectedRequest) {
  if (
    !object(value) ||
    value.requestId !== requestId ||
    value.verified !== false ||
    !["not_found", "completed_previously"].includes(value.status)
  )
    return stateError();
  if (value.status === "not_found") return { ...value, verified: false };
  let request;
  try {
    request = normalizeApartmentReservationRequest(value.request);
  } catch {
    return stateError();
  }
  if (
    value.actorId !== actorId ||
    request.requestId !== requestId ||
    (expectedRequest && !isDeepStrictEqual(request, expectedRequest))
  )
    return stateError();
  resultShape(value.result, request, actorId);
  return { ...value, verified: false };
}
