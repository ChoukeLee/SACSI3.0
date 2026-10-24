"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  CimacBillingWriteKind,
  CimacCollectionInput,
  CimacFeeTermInput,
  CimacMeterReadingInput,
} from "./cimac-billing-types";
import {
  decodeCimacWriteReceipt,
  decodeCimacWriteResult,
  parseCimacCollectionInput,
  parseCimacFeeTermInput,
  parseCimacMeterReadingInput,
  parseCimacRequestId,
  type CimacRequestInput,
  type CimacWriteReceiptResult,
  type CimacWriteResult,
} from "./cimac-billing-service";

const errors: Record<string, string> = {
  cimacBillingInvalidInput: "请核对客户、合同、房屋、日期及精确金额；待核约定和抄表不会生成应收。",
  cimacBillingPermissionDenied: "当前账号无权操作所选客户的建材城账务。",
  cimacBillingTargetMismatch: "客户、合同、房屋或账单归属不一致，请刷新核对。",
  cimacBillingSnapshotChanged: "资料或账单余额已变化，请保留原操作编号，先核对原结果和最新记录。",
  cimacBillingRequestIdConflict: "原操作编号已用于其他账号或内容，请先核对原结果，不要另建一笔。",
  cimacBillingUnsupportedCurrency:
    "客户跨合同收款目前只支持 XOF；USD、CNY 保留原币并继续使用原有收款入口。",
  cimacBillingProtectedPayment: "该收款受核销保护，请使用对应的冲正或退款流程，不能直接改写。",
  cimacBillingAccountTooLarge: "该客户账务记录较多，暂时无法完整加载，请联系管理员核对。",
};
const unknownResult =
  "操作结果暂未确认，请保留原操作编号和原内容，查询结果或原号重试，避免重复录入。";
type WriteInput = CimacCollectionInput | CimacFeeTermInput | CimacMeterReadingInput;

// Reviewed in each RPC: these guards run only after the request advisory lock
// and after proving no earlier same-ID journal result exists. Target/permission/
// validation errors can run before that proof and must stay unknown.
const definiteRejections: Record<CimacBillingWriteKind, readonly string[]> = {
  collection: ["cimacBillingSnapshotChanged"],
  fee_terms: ["cimacBillingSnapshotChanged"],
  meter_reading: ["cimacBillingSnapshotChanged"],
};

async function invalidate(customerId: string) {
  for (const path of [
    "/finance",
    "/fr/finance",
    "/customers",
    "/fr/customers",
    `/customers/${customerId}`,
    `/fr/customers/${customerId}`,
    "/leases",
    "/fr/leases",
    "/sales",
    "/fr/sales",
    "/reports",
    "/fr/reports",
    "/units",
    "/fr/units",
    "/management",
    "/fr/management",
  ]) {
    try {
      revalidatePath(path);
    } catch {
      // A cache failure cannot invalidate proof of an already completed write.
    }
  }
}

async function write<T extends WriteInput>(
  raw: unknown,
  parse: (raw: unknown) => CimacRequestInput<T>,
  kind: CimacBillingWriteKind,
  rpc: string,
): Promise<CimacWriteResult> {
  // Boss and operational roles remain read-only here; the database checks project scope again.
  const actor = await requireRole("admin", "finance");
  let input: CimacRequestInput<T>;
  try {
    input = parse(raw);
  } catch {
    // Invalid retry content says nothing about a previously committed request.
    return { success: false, rejected: false, error: errors.cimacBillingInvalidInput };
  }
  const { requestId, ...payload } = input;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(rpc, {
      p_input: payload,
      p_request_id: requestId,
    });
    if (error) {
      const rejected = error.code === "P0001" && definiteRejections[kind].includes(error.message);
      return {
        success: false,
        rejected,
        error: rejected
          ? "资料或账单余额已变化，本次未保存。请刷新核对最新记录后重试。"
          : (errors[error.message] ?? unknownResult),
      };
    }
    const result = decodeCimacWriteResult(data, input, kind, actor.id);
    await invalidate(input.customerId);
    return result;
  } catch {
    return { success: false, rejected: false, error: unknownResult };
  }
}

/** Records one actual receipt against explicit, existing, same-customer XOF bills. */
export async function recordCimacCollection(
  raw: CimacRequestInput<CimacCollectionInput>,
): Promise<CimacWriteResult> {
  return write(raw, parseCimacCollectionInput, "collection", "cimac_collect_customer_rpc");
}

/** Saves evidence only. This action neither creates bills nor treats pending rules as confirmed. */
export async function saveCimacFeeTerms(
  raw: CimacRequestInput<CimacFeeTermInput>,
): Promise<CimacWriteResult> {
  return write(raw, parseCimacFeeTermInput, "fee_terms", "cimac_save_fee_terms_rpc");
}

/** Saves readings/usage without inventing a rate, charge, receivable or payment. */
export async function saveCimacMeterReading(
  raw: CimacRequestInput<CimacMeterReadingInput>,
): Promise<CimacWriteResult> {
  return write(raw, parseCimacMeterReadingInput, "meter_reading", "cimac_save_meter_reading_rpc");
}

/** Read-only recovery; not_found is not proof an in-flight transaction cannot commit. */
export async function readCimacWriteReceipt(requestId: string): Promise<CimacWriteReceiptResult> {
  await requireRole("admin", "finance", "boss");
  let canonicalId: string;
  try {
    canonicalId = parseCimacRequestId(requestId);
  } catch {
    return { status: "unavailable", error: "缺少有效的原操作编号，无法核对结果。" };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cimac_billing_request_rpc", {
      p_request_id: canonicalId,
    });
    if (error) return { status: "unavailable", error: errors[error.message] ?? unknownResult };
    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      data.status === "not_found" &&
      data.requestId === canonicalId
    )
      return { status: "not_found" };
    return { status: "found", receipt: decodeCimacWriteReceipt(data, canonicalId) };
  } catch {
    return { status: "unavailable", error: "暂时无法核对结果，请保留原操作编号和原内容。" };
  }
}
