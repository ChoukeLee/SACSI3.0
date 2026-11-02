import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CimacWorkspaceScope } from "./cimac-workspace-types";
import { readCimacApartments } from "./cimac-apartment-read";
import {
  apartmentObject,
  apartmentTimestamp,
  apartmentUuid,
  CimacApartmentReservationError,
  parseCimacApartmentReservationRequest,
  type CimacApartmentReservationRequest,
  type CimacApartmentReservationResultRoom,
} from "./cimac-apartment-reservation-model";

type Client = Pick<SupabaseClient, "from" | "rpc">;
const knownErrors = new Set([
  "InvalidRequest",
  "DuplicateUnit",
  "ScopeDenied",
  "RequestConflict",
  "Drift",
  "UnitChanged",
  "AlreadyHeld",
  "BusinessConflict",
  "Changed",
  "Denied",
  "AuditDenied",
  "AuditImmutable",
]);
export function apartmentReservationDatabaseError(error: {
  message?: string;
  code?: string;
}): CimacApartmentReservationError {
  const suffix = error.message?.match(/\bCimacApartmentReservations([A-Za-z]+)\b/)?.[1];
  if (suffix && knownErrors.has(suffix))
    return new CimacApartmentReservationError(
      `CimacApartmentReservations${suffix}`,
      /Denied|Immutable/.test(suffix)
        ? 403
        : /InvalidRequest|DuplicateUnit/.test(suffix)
          ? 400
          : 409,
    );
  if (error.message?.includes("CimacApartmentsDenied") || error.code === "42501")
    return new CimacApartmentReservationError("apartment_reservation_forbidden", 403);
  if (["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code ?? ""))
    return new CimacApartmentReservationError("apartment_reservation_upgrade_required", 503);
  return new CimacApartmentReservationError();
}

export function parseApartmentUnitNos(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (
    !Array.isArray(raw) ||
    !raw.length ||
    raw.length > 64 ||
    raw.some(
      (n) => typeof n !== "string" || n.length !== 3 || !/^[2-5](?:0[1-9]|1[0-6])$/.test(n),
    ) ||
    new Set(raw).size !== raw.length
  )
    throw new CimacApartmentReservationError("invalid_apartment_query", 400);
  return raw;
}

export async function readCimacApartmentReservationOptions(
  client: Client,
  scope: CimacWorkspaceScope,
  actorId: string,
  unitNos?: string[],
) {
  const data = await readCimacApartments(client, scope);
  const wanted = unitNos ? new Set(unitNos) : null;
  const rooms = data.rooms
    .filter(
      (room) =>
        (!wanted || wanted.has(room.unitNo)) &&
        room.registered &&
        room.unitId &&
        room.unitUpdatedAt,
    )
    .map((room) => ({
      unitId: room.unitId!,
      unitNo: room.unitNo,
      unitUpdatedAt: room.unitUpdatedAt!,
      reservation: room.reservation ?? null,
    }));
  if (unitNos && rooms.length !== unitNos.length)
    throw new CimacApartmentReservationError("apartment_catalogue_not_initialized", 409);
  return {
    success: true as const,
    actorId,
    projectId: data.projectId,
    buildingId: data.buildingId,
    schemaAvailable: data.reservationSchemaAvailable === true,
    rooms,
  };
}

export function verifyApartmentReservationResult(
  raw: unknown,
  input: CimacApartmentReservationRequest,
  actorId: string,
  projectId: string,
  buildingId: string,
  unitNos: Map<string, string>,
) {
  if (
    !apartmentObject(raw) ||
    raw.success !== true ||
    raw.requestId !== input.requestId ||
    raw.actorId !== actorId ||
    raw.projectId !== projectId ||
    raw.buildingId !== buildingId ||
    typeof raw.idempotent !== "boolean" ||
    !Array.isArray(raw.rooms) ||
    raw.rooms.length !== input.operations.length
  )
    throw new CimacApartmentReservationError("apartment_reservation_result_unverified");
  const seen = new Set<string>();
  const rooms = raw.rooms.map((value, index): CimacApartmentReservationResultRoom => {
    const expected = input.operations[index];
    if (
      !apartmentObject(value) ||
      value.unitId !== expected.unitId ||
      value.unitNo !== unitNos.get(expected.unitId) ||
      !apartmentUuid(value.reservationId) ||
      seen.has(value.reservationId) ||
      value.status !== (expected.type === "cancel" ? "cancelled" : "reserved") ||
      value.paymentStatus !== "unpaid" ||
      typeof value.reserverName !== "string" ||
      !value.reserverName.trim() ||
      value.reserverName.length > 200 ||
      !apartmentTimestamp(value.updatedAt) ||
      (expected.type !== "cancel" && value.reserverName !== expected.reserverName) ||
      (expected.type !== "reserve" && value.reservationId !== expected.expectedReservationId)
    )
      throw new CimacApartmentReservationError("apartment_reservation_result_unverified");
    seen.add(value.reservationId);
    return {
      unitId: expected.unitId,
      unitNo: value.unitNo as string,
      reservationId: value.reservationId,
      status: value.status as "reserved" | "cancelled",
      reserverName: value.reserverName,
      paymentStatus: "unpaid",
      updatedAt: value.updatedAt,
    };
  });
  return {
    success: true as const,
    requestId: input.requestId,
    actorId,
    projectId,
    buildingId,
    idempotent: raw.idempotent,
    rooms,
  };
}

export async function executeApartmentReservations(
  client: Client,
  scope: CimacWorkspaceScope,
  actorId: string,
  raw: unknown,
) {
  const input = parseCimacApartmentReservationRequest(raw);
  const options = await readCimacApartmentReservationOptions(client, scope, actorId);
  if (!options.schemaAvailable)
    throw new CimacApartmentReservationError("apartment_reservation_upgrade_required", 503);
  const numbers = new Map(options.rooms.map((room) => [room.unitId, room.unitNo]));
  if (input.operations.some((op) => !numbers.has(op.unitId)))
    throw new CimacApartmentReservationError("apartment_reservation_forbidden", 403);
  const { data, error } = await client.rpc("cimac_apartment_reservations_execute_rpc", {
    p_request: input,
  });
  if (error) throw apartmentReservationDatabaseError(error);
  return verifyApartmentReservationResult(
    data,
    input,
    actorId,
    options.projectId,
    options.buildingId,
    numbers,
  );
}

export async function readApartmentReservationStatus(
  client: Client,
  scope: CimacWorkspaceScope,
  actorId: string,
  requestId: string,
) {
  if (!apartmentUuid(requestId))
    throw new CimacApartmentReservationError("invalid_request_id", 400);
  const { data, error } = await client.rpc("cimac_apartment_reservations_status_rpc", {
    p_request_id: requestId.toLowerCase(),
  });
  if (error) throw apartmentReservationDatabaseError(error);
  if (
    !apartmentObject(data) ||
    data.requestId !== requestId.toLowerCase() ||
    data.verified !== false
  )
    throw new CimacApartmentReservationError("apartment_reservation_status_unavailable");
  if (data.status === "not_found")
    return {
      status: "not_found" as const,
      verified: false as const,
      requestId: requestId.toLowerCase(),
    };
  if (
    data.status !== "completed_previously" ||
    data.actorId !== actorId ||
    !apartmentObject(data.result)
  )
    throw new CimacApartmentReservationError("apartment_reservation_status_unavailable");
  const input = parseCimacApartmentReservationRequest(data.request);
  if (input.requestId !== requestId.toLowerCase())
    throw new CimacApartmentReservationError("apartment_reservation_status_unavailable");
  const options = await readCimacApartmentReservationOptions(client, scope, actorId);
  const result = verifyApartmentReservationResult(
    data.result,
    input,
    actorId,
    options.projectId,
    options.buildingId,
    new Map(options.rooms.map((room) => [room.unitId, room.unitNo])),
  );
  return {
    status: "completed_previously" as const,
    verified: false as const,
    requestId: input.requestId,
    actorId,
    request: input,
    result,
  };
}
