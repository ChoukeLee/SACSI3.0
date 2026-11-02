"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readCimacWorkspaceScope } from "./cimac-workspace-read";
import {
  executeApartmentReservations,
  readApartmentReservationStatus,
} from "./cimac-apartment-reservation-service";
import {
  CimacApartmentReservationError,
  type CimacApartmentReservationActionResult,
  type CimacApartmentReservationRequest,
} from "./cimac-apartment-reservation-model";

async function context() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin" || !hasPermission(user, "units:write"))
    throw new CimacApartmentReservationError("apartment_reservation_forbidden", 403);
  const client = await createClient();
  return { user, client, scope: await readCimacWorkspaceScope(client) };
}
function failure(error: unknown): {
  success: false;
  error: string;
  outcome: "rejected" | "unknown";
} {
  if (error instanceof CimacApartmentReservationError && error.status < 500)
    return {
      success: false,
      outcome: "rejected",
      error:
        error.status === 403
          ? "当前账号无权维护这间公寓。"
          : error.status === 400
            ? "预留信息不完整或格式错误，请核对房号与姓名。"
            : "房间或预留资料已发生变化，请刷新核对；未覆盖现有记录。",
    };
  return {
    success: false,
    outcome: "unknown",
    error: "尚未核实预留登记结果，请保留原请求号查询，不要换号重录。",
  };
}
export async function executeCimacApartmentReservations(
  input: CimacApartmentReservationRequest,
): Promise<CimacApartmentReservationActionResult> {
  try {
    const { user, client, scope } = await context();
    const result = await executeApartmentReservations(client, scope, user.id, input);
    revalidatePath("/cimac", "layout");
    revalidatePath("/fr/cimac", "layout");
    return {
      success: true,
      requestId: result.requestId,
      idempotent: result.idempotent,
      rooms: result.rooms,
    };
  } catch (error) {
    return failure(error);
  }
}
export async function checkCimacApartmentReservationStatus(
  requestId: string,
): Promise<
  | { success: false; error: string }
  | { success: true; requestId: string; found: boolean; verified: false }
> {
  try {
    const { user, client, scope } = await context();
    const result = await readApartmentReservationStatus(client, scope, user.id, requestId);
    return {
      success: true,
      requestId: result.requestId,
      found: result.status === "completed_previously",
      verified: false,
    };
  } catch (error) {
    return failure(error);
  }
}
