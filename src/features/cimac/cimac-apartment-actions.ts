"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readCimacWorkspaceScope } from "./cimac-workspace-read";
import { cimacWorkspaceUuid } from "./cimac-workspace-query";
import type { CimacApartmentInitializationResult } from "./cimac-apartment-model";

export async function initializeCimacApartments(
  requestId: string,
): Promise<CimacApartmentInitializationResult> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin" || !hasPermission(user, "units:write"))
    return { success: false, error: "仅有建材城权限的管理员可建立房间台账。" };
  if (typeof requestId !== "string" || !cimacWorkspaceUuid.test(requestId))
    return { success: false, error: "操作编号无效，请保留原请求核对。" };
  requestId = requestId.toLowerCase();
  try {
    const client = await createClient();
    const scope = await readCimacWorkspaceScope(client);
    const buildings = scope.buildings.filter((b) => b.code === "CIMAC-B17" && b.isActive);
    if (buildings.length !== 1) return { success: false, error: "当前账号无法核实17栋范围。" };
    const { data, error } = await client.rpc("cimac_apartments_initialize_rpc", {
      p_request_id: requestId,
    });
    if (error) {
      const reason = error.message ?? "";
      return {
        success: false,
        error:
          reason.includes("Conflict") || reason.includes("AlreadyInitialized")
            ? "已有房号或房间资料与本次清单冲突，请刷新并核对，不会覆盖现有记录。"
            : ["PGRST202", "42883"].includes(error.code)
              ? "公寓台账尚未启用，请先完成数据库迁移。"
              : "尚未确认建立结果，请保留当前请求号重试，不要换号重复建立。",
      };
    }
    if (
      !data ||
      data.success !== true ||
      data.requestId !== requestId ||
      data.actorId !== user.id ||
      data.projectId !== scope.project.id ||
      data.buildingId !== buildings[0].id ||
      data.roomCount !== 64 ||
      typeof data.idempotent !== "boolean" ||
      !Array.isArray(data.unitIds) ||
      data.unitIds.length !== 64 ||
      data.unitIds.some((id: unknown) => typeof id !== "string" || !cimacWorkspaceUuid.test(id)) ||
      new Set(data.unitIds).size !== 64
    )
      return { success: false, error: "无法核实建立结果，请保留当前请求号刷新核对。" };
    revalidatePath("/cimac", "layout");
    revalidatePath("/fr/cimac", "layout");
    return { success: true, requestId, roomCount: 64, idempotent: data.idempotent };
  } catch {
    return { success: false, error: "尚未确认建立结果，请保留当前请求号刷新核对。" };
  }
}
