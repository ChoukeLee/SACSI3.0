"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readCimacWorkspaceScope } from "./cimac-workspace-read";
import { apartmentPaidStatus, executeApartmentPaid } from "./cimac-apartment-paid-service";
import { ApartmentPaidError, type ApartmentPaidRequest } from "./cimac-apartment-paid-model";

async function context() {
  const user = await getCurrentUser();
  if (!user || !["admin", "finance"].includes(user.role) || !hasPermission(user, "finance:write"))
    throw new ApartmentPaidError("apartment_paid_denied", 403);
  const client = await createClient();
  return { user, client, scope: await readCimacWorkspaceScope(client) };
}
function failure(error: unknown) {
  if (error instanceof ApartmentPaidError && error.status < 500)
    return {
      success: false as const,
      outcome: "rejected" as const,
      error:
        error.status === 403
          ? "当前账号无权登记这间公寓的已收押租。"
          : error.status === 400
            ? "请核对完整月租期、收款日期、方式及原币金额。"
            : "房间、客户或收据已发生变化，未覆盖现有记录；请刷新核对。",
    };
  return {
    success: false as const,
    outcome: "unknown" as const,
    error: "尚未核实收款登记结果，请保留原请求号查询或原样重试，不要换号重录。",
  };
}
export async function executeApartmentPaidReceipt(input: ApartmentPaidRequest) {
  try {
    const { user, client, scope } = await context();
    const result = await executeApartmentPaid(client, scope, user.id, input);
    for (const path of [
      "/cimac",
      "/fr/cimac",
      "/finance",
      "/fr/finance",
      "/customers",
      "/fr/customers",
    ])
      revalidatePath(path, "layout");
    return result;
  } catch (error) {
    return failure(error);
  }
}
export async function checkApartmentPaidStatus(requestId: string) {
  try {
    const { user, client, scope } = await context();
    return await apartmentPaidStatus(client, scope, user.id, requestId);
  } catch (error) {
    return failure(error);
  }
}
