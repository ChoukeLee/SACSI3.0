import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CimacWorkspaceScope } from "./cimac-workspace-types";
import { assertCimacWorkspaceScope } from "./cimac-workspace-model";
import { apartmentObject, apartmentUuid } from "./cimac-apartment-reservation-model";
import {
  ApartmentPaidError,
  parseApartmentPaidRequest,
  verifyApartmentPaidResult,
} from "./cimac-apartment-paid-model";

type Client = Pick<SupabaseClient, "rpc" | "from">;
const errors = new Set([
  "Invalid",
  "AmountMismatch",
  "DuplicateTarget",
  "Denied",
  "ScopeChanged",
  "BusinessConflict",
  "CustomerConflict",
  "RequestConflict",
  "DuplicateReceipt",
  "Immutable",
]);
export function paidDatabaseError(error: { message?: string; code?: string }) {
  const suffix = error.message?.match(/\bCimacApartmentPaid([A-Za-z]+)\b/)?.[1];
  if (suffix && errors.has(suffix))
    return new ApartmentPaidError(
      `CimacApartmentPaid${suffix}`,
      suffix === "Denied"
        ? 403
        : ["Invalid", "AmountMismatch", "DuplicateTarget"].includes(suffix)
          ? 400
          : 409,
    );
  if (error.code === "42501") return new ApartmentPaidError("apartment_paid_denied", 403);
  return new ApartmentPaidError();
}
function building(scope: CimacWorkspaceScope) {
  assertCimacWorkspaceScope(scope);
  const matches = scope.buildings.filter((b) => b.code === "CIMAC-B17" && b.isActive);
  if (matches.length !== 1) throw new ApartmentPaidError("apartment_paid_denied", 403);
  return matches[0];
}
async function numbers(client: Client, scope: CimacWorkspaceScope, unitIds: string[]) {
  const b = building(scope);
  const { data, error, count } = await client
    .from("cimac_apartment_profiles")
    .select("unit_id,building_id,floor_number,room_suffix", { count: "exact" })
    .eq("building_id", b.id)
    .in("unit_id", unitIds)
    .range(0, 64);
  if (error) throw paidDatabaseError(error);
  if (!Array.isArray(data) || count !== data.length || data.length !== unitIds.length)
    throw new ApartmentPaidError("apartment_paid_scope", 409);
  const map = new Map<string, string>();
  for (const r of data) {
    const no = String(Number(r.floor_number) * 100 + Number(r.room_suffix));
    if (
      !unitIds.includes(r.unit_id) ||
      r.building_id !== b.id ||
      map.has(r.unit_id) ||
      !/^([2-5])(0[1-9]|1[0-6])$/.test(no)
    )
      throw new ApartmentPaidError();
    map.set(r.unit_id, no);
  }
  return { b, map };
}
export async function executeApartmentPaid(
  client: Client,
  scope: CimacWorkspaceScope,
  actorId: string,
  raw: unknown,
) {
  const input = parseApartmentPaidRequest(raw),
    { b, map } = await numbers(
      client,
      scope,
      input.rooms.map((r) => r.unitId),
    );
  const { data, error } = await client.rpc("cimac_apartment_paid_receipt_execute_rpc", {
    p_request: input,
  });
  if (error) throw paidDatabaseError(error);
  return verifyApartmentPaidResult(data, input, actorId, scope.project.id, b.id, map);
}
export async function apartmentPaidStatus(
  client: Client,
  scope: CimacWorkspaceScope,
  actorId: string,
  requestId: string,
) {
  building(scope);
  if (!apartmentUuid(requestId)) throw new ApartmentPaidError("apartment_paid_input", 400);
  const id = requestId.toLowerCase(),
    { data, error } = await client.rpc("cimac_apartment_paid_receipt_status_rpc", {
      p_request_id: id,
    });
  if (error) throw paidDatabaseError(error);
  if (
    apartmentObject(data) &&
    data.success === false &&
    data.status === "not_found" &&
    data.requestId === id
  )
    return { success: true as const, requestId: id, found: false, verified: false as const };
  if (!apartmentObject(data) || !apartmentObject(data.data) || data.data.requestId !== id)
    throw new ApartmentPaidError();
  const input = parseApartmentPaidRequest(data.data.request),
    { b, map } = await numbers(
      client,
      scope,
      input.rooms.map((r) => r.unitId),
    );
  verifyApartmentPaidResult(data, input, actorId, scope.project.id, b.id, map);
  return { success: true as const, requestId: id, found: true, verified: false as const };
}
