"use server";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { refreshLeaseViews, leaseRequestRejected } from "./lease-lifecycle-service";
import type { LeaseRentPeriodInput, LeaseRentPeriodReview } from "./lease-rent-period-model";
import { parseLeaseRentPeriodInput } from "./lease-rent-period-model";

const messages: Record<string, string> = {
  leasePeriodPermissionDenied: "当前账号无权更正该合同的账期。",
  leasePeriodChanged: "账务记录已变化，请重新打开更正窗口核对。",
  leasePeriodReviewRequired: "存在多笔收款、部分核销或非自动账单，请交由财务逐笔复核，未修改记录。",
  invalidLeasePeriodCorrection: "请选择原收款、对应已结账单，填写有效的缴至日期及依据。",
  requestIdConflict: "原请求号已用于其他内容，请先核对原结果，不能另起一笔重试。",
};

export async function reviewLeaseRentPeriod(contractId: string) {
  await requireRole("admin");
  const client = await createClient();
  const { data, error } = await client.rpc("lease_rent_period_review_rpc", {
    p_contract_id: contractId,
  });
  if (error)
    return {
      success: false as const,
      error: messages[error.message] ?? "无法读取账务快照，请稍后重试。",
    };
  const review: LeaseRentPeriodReview = {
    contractId: data.contractId,
    token: data.token,
    paidThroughDate: data.paidThroughDate,
    payments: data.payments
      .filter((p: { source_type: string }) => p.source_type === "lease_rent")
      .map(
        (p: {
          id: string;
          payment_date: string;
          amount: number;
          currency: string;
          receipt_no: string;
        }) => ({
          id: p.id,
          paymentDate: p.payment_date,
          amount: Number(p.amount),
          currency: p.currency,
          receiptNo: p.receipt_no,
        }),
      ),
    receivables: data.receivables
      .filter((r: { status: string }) => r.status === "paid")
      .map(
        (r: {
          id: string;
          title: string;
          amount_xof: number;
          service_period_end: string | null;
        }) => ({
          id: r.id,
          title: r.title,
          amountXof: Number(r.amount_xof),
          periodEnd: r.service_period_end,
        }),
      ),
  };
  return { success: true as const, data: review };
}

export async function correctLeaseRentPeriod(
  contractId: string,
  input: LeaseRentPeriodInput,
  requestId: string,
) {
  await requireRole("admin");
  try {
    parseLeaseRentPeriodInput(input);
  } catch {
    return { success: false, rejected: true, error: messages.invalidLeasePeriodCorrection };
  }
  const client = await createClient();
  const { data, error } = await client.rpc("correct_lease_rent_period_rpc", {
    p_contract_id: contractId,
    p_input: input,
    p_request_id: requestId,
  });
  if (error)
    return {
      success: false,
      error: messages[error.message] ?? "结果未确认，请保留原请求号并原样重试。",
      rejected: leaseRequestRejected(error.code, error.message),
    };
  if (!data?.success)
    return { success: false, rejected: false, error: "结果未确认，请保留原请求号并原样重试。" };
  refreshLeaseViews();
  return { success: true, rejected: false };
}
