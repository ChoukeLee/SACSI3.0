import "server-only";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const errors: Record<string, string> = {
  financePermissionDenied: "当前账号无权执行此操作。",
  financeAccessDenied: "当前账号无权访问该项目。",
  financeBuildingRequired: "请选择所属楼栋，不能以未分配项目的记录绕过项目权限。",
  unitBuildingMismatch: "房间与所选楼栋不一致。",
  financeRecordChanged: "记录已变化，请刷新核对后重试。",
  requestIdRequired: "缺少操作编号，请刷新页面。",
  requestIdConflict: "操作编号已用于其他内容或账号，请先核对原结果。",
  invalidFinancePayload: "请核对日期、正数金额、币种及历史汇率。",
  flexiblePlanRequired: "只有灵活分期合同可新增分期。",
  installmentAlreadyExists: "该分期编号已存在，请刷新核对。",
  ambiguousSaleReceivable: "存在同日期同金额的应收，不能自动判断分期对应关系。",
  paymentLinkRequiresReview: "原收款与本次流水不匹配或已记账，请先核对。",
};
export async function submitFinanceOperation<T = unknown>(
  operation: string,
  input: unknown,
  requestId: string,
): Promise<{ success: boolean; data?: T; error?: string; rejected: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_operation_rpc", {
    p_operation: operation,
    p_input: input,
    p_request_id: requestId,
  });
  if (error)
    return {
      success: false,
      error: errors[error.message] ?? error.message,
      rejected:
        error.message !== "requestIdConflict" &&
        /^(P0001|42501|22[0-9A-Z]{3}|23[0-9A-Z]{3}|40001|40P01)$/.test(error.code ?? ""),
    };
  if (!data?.success)
    return { success: false, error: "结果未知，请保留原操作编号重试。", rejected: false };
  for (const path of [
    "/finance",
    "/fr/finance",
    "/sales",
    "/fr/sales",
    "/daily-rentals",
    "/fr/daily-rentals",
    "/units",
    "/fr/units",
    "/management",
    "/fr/management",
  ])
    revalidatePath(path);
  return { success: true, data: data.data as T, rejected: false };
}
