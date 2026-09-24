import "server-only";
import { revalidatePath } from "next/cache";

export function refreshLeaseViews() {
  for (const path of ["/leases", "/fr/leases", "/finance", "/fr/finance", "/units", "/fr/units"])
    revalidatePath(path);
}
export function leaseLifecycleError(message: string): string {
  const errors: Record<string, string> = {
    leasePermissionDenied: "当前账号无权执行此操作。",
    leaseFinancePermissionDenied: "当前账号没有长租财务入账权限，请由财务账号登记实收。",
    leaseAccessDenied: "当前账号无权访问该房源或合同。",
    leaseChanged: "合同已变化，请刷新并重新核对后提交。",
    requestIdConflict: "原请求内容或账号已变化。请先核对原请求结果，不能直接另起一笔。",
    leaseRequestIdRequired: "缺少操作编号，请重新打开表单。",
    leaseActiveConflict: "该房源已有生效中的长租合同。",
    leaseDraftRequired: "合同已不是草稿，请刷新查看。",
    leaseActiveRequired: "合同已不是生效状态，请刷新查看。",
    leaseDatesRequireReview: "合同尚未起租或日期未确认，不能自动生成应收。",
    leaseUnitNotOperational: "请先核对房源是否可投入使用。",
    leaseDepositReviewRequired: "实收押金、已退押金与本次退还/扣除不一致，请核对原始流水。",
    leaseReceivableReviewRequired: "存在待核实应收或未来已收租金，请先核对，系统不会自动冲销。",
    leaseCollectionConfirmationRequired: "请确认补收租金已实际收到；未付金额不能直接当作收款。",
    leaseCollectionExceedsOutstanding: "本次实收超过已有到期欠租，请先核对应收。",
    leaseAlreadySettled: "该合同已有退租结算，不能重复结算。",
    leaseSettlementStateInvalid: "该合同当前不能办理退租结算。",
    paymentMethodRequired: "请选择实际收退款方式。",
    invalidLeaseSettlement: "请核对退租日期及非负金额。",
    invalidLeasePayload: "请核对合同日期、金额和付款周期。",
    leaseTermTooLong: "合同期限超过自动应收支持范围，请核对。",
  };
  return errors[message] ?? message;
}

/** PostgreSQL rejection rolls the entire RPC back; transport errors do not prove that. */
export function leaseRequestRejected(code?: string, message?: string): boolean {
  // A conflicting identity may refer to a prior committed operation.
  if (message === "requestIdConflict") return false;
  return !!code && /^(P0001|42501|22[0-9A-Z]{3}|23[0-9A-Z]{3}|40001|40P01)$/.test(code);
}
