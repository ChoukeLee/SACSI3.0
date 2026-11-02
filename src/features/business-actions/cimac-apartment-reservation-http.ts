import "server-only";
import { revalidatePath } from "next/cache";
import { authenticateOperatorRequest } from "./operator-request-auth";
import { extractBearerToken } from "./operator-auth-header";
import { operatorAuthFailure } from "./operator-auth-failure";
import { directExecutionEnabled } from "./operator-direct-execution";
import { confirmationReply as reply } from "./operator-confirmation-http";
import { readCimacWorkspaceScope } from "@/features/cimac/cimac-workspace-read";
import {
  apartmentObject,
  apartmentUuid,
  CimacApartmentReservationError,
  parseCimacApartmentReservationRequest,
} from "@/features/cimac/cimac-apartment-reservation-model";
import {
  apartmentReservationDatabaseError,
  executeApartmentReservations,
  parseApartmentUnitNos,
  readApartmentReservationStatus,
  readCimacApartmentReservationOptions,
} from "@/features/cimac/cimac-apartment-reservation-service";

/** Connector authentication never falls back to a browser identity. No arbitrary SQL or financial fields. */
export async function cimacApartmentReservationHttp(
  request: Request,
  operation: "query" | "execute" | "status",
) {
  if (operation === "execute" && !directExecutionEnabled())
    return reply({ code: "direct_execution_not_enabled" }, 503);
  if (!extractBearerToken(request.headers.get("authorization"))) {
    const failure = operatorAuthFailure("missing_or_invalid_session");
    return reply(failure.body, failure.status);
  }
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    const failure = operatorAuthFailure(auth.reason);
    return reply(failure.body, failure.status);
  }
  if (auth.mode !== "bearer" || auth.user.role !== "admin")
    return reply({ code: "apartment_reservation_forbidden" }, 403);
  let requestId: string | undefined;
  let attempted = false;
  try {
    const scope = await readCimacWorkspaceScope(auth.supabase);
    const [version, allowed] = await Promise.all([
      auth.supabase.rpc("cimac_apartment_reservations_protocol_version"),
      auth.supabase.rpc("can_execute_cimac_apartment_reservations"),
    ]);
    if (version.error) throw apartmentReservationDatabaseError(version.error);
    if (allowed.error) throw apartmentReservationDatabaseError(allowed.error);
    if (version.data !== 1)
      throw new CimacApartmentReservationError("apartment_reservation_upgrade_required", 503);
    if (allowed.data !== true)
      throw new CimacApartmentReservationError("apartment_reservation_forbidden", 403);
    if (operation === "status") {
      const params = new URL(request.url).searchParams;
      const id = params.get("requestId");
      if (
        [...params.keys()].some((key) => key !== "requestId") ||
        params.getAll("requestId").length !== 1 ||
        !apartmentUuid(id)
      )
        throw new CimacApartmentReservationError("invalid_request_id", 400);
      return reply(
        await readApartmentReservationStatus(auth.supabase, scope, auth.user.id, id),
        200,
      );
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 131072)
      return reply({ code: "request_too_large" }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return reply({ code: "invalid_json" }, 400);
    }
    if (operation === "query") {
      if (!apartmentObject(raw) || Object.keys(raw).some((key) => key !== "unitNos"))
        throw new CimacApartmentReservationError("invalid_apartment_query", 400);
      return reply(
        await readCimacApartmentReservationOptions(
          auth.supabase,
          scope,
          auth.user.id,
          parseApartmentUnitNos(raw.unitNos),
        ),
        200,
      );
    }
    const input = parseCimacApartmentReservationRequest(raw);
    requestId = input.requestId;
    attempted = true;
    const result = await executeApartmentReservations(auth.supabase, scope, auth.user.id, input);
    revalidatePath("/cimac", "layout");
    revalidatePath("/fr/cimac", "layout");
    return reply(result, 200);
  } catch (error) {
    if (error instanceof CimacApartmentReservationError && error.status < 500)
      return reply({ code: error.code, requestId, verified: false }, error.status);
    if (attempted)
      return reply(
        {
          status: "execution_unknown",
          verified: false,
          requestId,
          code: "apartment_reservation_outcome_unknown",
          retryPolicy: "recheck_same_request_id_only",
        },
        503,
      );
    return reply(
      {
        code:
          error instanceof CimacApartmentReservationError
            ? error.code
            : "apartment_reservation_unavailable",
        verified: false,
      },
      503,
    );
  }
}
