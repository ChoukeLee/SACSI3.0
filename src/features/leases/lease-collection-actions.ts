"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guardLeaseFinance } from "./lease-action-guards";
import { requireRole } from "@/lib/auth";
import {
  decodeLeaseCollectionResult,
  decodeLeaseCollectionReceipt,
  parseLeaseCollectionInput,
} from "./lease-collection-service";
import type {
  LeaseCollectionInput,
  LeaseCollectionResult,
  LeaseCollectionReceiptResult,
} from "./lease-collection-types";

const errors: Record<string, string> = {
  invalidLeaseCollection: "请核对实收日期、金额、币种及分配金额；总实收必须与分配合计一致。",
  leaseCollectionPermissionDenied: "当前账号无权登记长租收款。",
  leaseCollectionAccessDenied: "当前账号无权访问该合同所属项目。",
  leaseCollectionNotFound: "未找到所选长租合同。",
  leaseCollectionContractChanged: "合同状态已变化，请刷新合同后核对。",
  leaseCollectionTargetMismatch: "所选账单与合同、房间、客户或币种不一致，请刷新后核对。",
  leaseCollectionBalanceChanged: "账单余额或状态已变化，本次未入账。请刷新后重新核对分配。",
  leaseCollectionCoverageChanged:
    "合同或账期证据已变化，不能核实连续全额覆盖，本次未入账。请刷新后核对，或取消同步已缴至。",
  requestIdConflict: "原操作编号已用于其他账号或内容。请先核对原入账结果，不要直接另建一笔。",
};

export async function recordLeaseCollection(
  raw: LeaseCollectionInput,
): Promise<LeaseCollectionResult> {
  await guardLeaseFinance();
  let input: LeaseCollectionInput;
  try {
    input = parseLeaseCollectionInput(raw);
  } catch {
    // A malformed retry can still refer to an earlier committed request. Local
    // validation proves nothing about that request's persisted outcome.
    return { success: false, error: errors.invalidLeaseCollection, rejected: false };
  }
  const { requestId, ...payload } = input;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("lease_collection_rpc", {
      p_input: payload,
      p_request_id: requestId,
    });
    if (error) {
      // Only these four guards run AFTER the master request lock and after
      // proving that no prior result exists. SQLSTATE alone proves merely that
      // this attempt rolled back, not that an earlier same-ID attempt did not.
      const knownRollback =
        error.code === "P0001" &&
        [
          "leaseCollectionContractChanged",
          "leaseCollectionTargetMismatch",
          "leaseCollectionBalanceChanged",
          "leaseCollectionCoverageChanged",
        ].includes(error.message);
      return {
        success: false,
        rejected: knownRollback,
        error:
          errors[error.message] ??
          (knownRollback
            ? "本次收款未入账，请核对账单或稍后重试。"
            : "入账结果暂未确认，请保留原操作编号并原号重试，避免重复录入。"),
      };
    }
    const result = decodeLeaseCollectionResult(data, input);
    for (const path of [
      "/leases",
      "/fr/leases",
      "/finance",
      "/fr/finance",
      "/units",
      "/fr/units",
      "/management",
      "/fr/management",
      "/reports",
      "/fr/reports",
      `/leases/${input.contractId}/collect`,
      `/fr/leases/${input.contractId}/collect`,
    ])
      revalidatePath(path);
    return result;
  } catch {
    return {
      success: false,
      rejected: false,
      error: "入账结果暂未确认，请保留原操作编号并原号重试，避免重复录入。",
    };
  }
}

/** Read-only recovery. "not_found" is not proof an earlier request cannot commit. */
export async function readLeaseCollectionReceipt(
  requestId: string,
): Promise<LeaseCollectionReceiptResult> {
  await requireRole("admin", "finance", "boss");
  if (
    typeof requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  )
    return { status: "unavailable", error: "缺少有效的原操作编号，无法核对入账结果。" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("lease_collection_receipt_read_rpc", {
      p_request_id: requestId,
    });
    if (error?.code === "P0001" && error.message === "leaseCollectionNotFound")
      return { status: "not_found" };
    if (error)
      return {
        status: "unavailable",
        error: errors[error.message] ?? "暂时无法读取原入账结果，请保留原操作编号。",
      };
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.contractId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        data.contractId,
      )
    )
      throw new Error("invalidLeaseCollectionReceipt");
    return {
      status: "found",
      contractId: data.contractId.toLowerCase(),
      receipt: decodeLeaseCollectionReceipt(data, requestId.toLowerCase()),
    };
  } catch {
    return { status: "unavailable", error: "暂时无法读取原入账结果，请保留原操作编号。" };
  }
}
