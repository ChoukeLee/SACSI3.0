"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { SaleContractRow, SalePaymentScheduleRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";
import { buildSaleContractNumber } from "@/lib/contract-number";
import { submitFinanceOperation } from "@/features/finance/finance-operation-service";

// ── Permission guards ──
async function guardSaleWrite() {
  await requireRole("admin", "rental_sales");
}
async function guardSaleFinance() {
  await requireRole("admin", "finance");
}

export async function recordSalePaymentAtomic(input: {
  contractId: string;
  scheduleId: string;
  amount: number;
  paymentDate: string;
  receiptNo?: string;
  requestId: string;
}): Promise<{ success: boolean; error?: string; rejected?: boolean }> {
  await guardSaleFinance();
  if (!input.requestId || !input.paymentDate || input.amount <= 0) {
    return { success: false, error: "收款请求无效。", rejected: true };
  }
  const supabase = await createClient();
  const receiptNo = input.receiptNo?.trim() || null;
  const { data, error } = await supabase.rpc("record_sale_payment_rpc", {
    p_contract_id: input.contractId,
    p_schedule_id: input.scheduleId,
    p_amount: input.amount,
    p_payment_date: input.paymentDate,
    p_receipt_no: receiptNo,
    p_request_id: input.requestId,
  });
  if (error)
    return {
      success: false,
      error: error.message,
      rejected:
        error.message !== "requestIdConflict" &&
        /^(P0001|42501|22[0-9A-Z]{3}|23[0-9A-Z]{3}|40001|40P01)$/.test(error.code ?? ""),
    };
  if (!data?.success)
    return { success: false, error: "结果未知，请保留原内容重试。", rejected: false };
  revalidatePath("/sales");
  revalidatePath("/fr/sales");
  return { success: true };
}

// ── Create sale contract ──

export async function createSaleContract(input: {
  unitId: string;
  customerId: string;
  contractNo: string;
  signedDate: string;
  totalAmountXof: number;
  paymentPlanType: string;
  numInstallments?: number;
  transferDate?: string;
  agencyCompany?: string;
  agentName?: string;
  agencyCommissionXof?: number;
  agencyCommissionPaid?: boolean;
  requestId: string;
}): Promise<{ success: boolean; data?: SaleContractRow; error?: string }> {
  await guardSaleWrite();
  const supabase = await createClient();

  const { data: contractUnit, error: unitError } = await supabase
    .from("units")
    .select("unit_no, building:buildings(code, project:projects(allows_sale))")
    .eq("id", input.unitId)
    .single();
  if (unitError || !contractUnit)
    return { success: false, error: unitError?.message ?? "未找到该房源。" };
  const contractBuilding = Array.isArray(contractUnit.building)
    ? contractUnit.building[0]
    : contractUnit.building;
  const contractProject = Array.isArray(contractBuilding?.project)
    ? contractBuilding.project[0]
    : contractBuilding?.project;
  if (contractProject?.allows_sale === false) {
    return { success: false, error: "该项目设置为只租不卖，不能创建出售合同。" };
  }
  const generatedContractNo = buildSaleContractNumber(
    contractBuilding?.code ?? "SACSI",
    contractUnit.unit_no,
    input.signedDate,
  );
  const { data: samePrefix, error: numberError } = await supabase
    .from("sale_contracts")
    .select("contract_no")
    .like("contract_no", `${generatedContractNo}%`);
  if (numberError) return { success: false, error: numberError.message };
  const contractNo = samePrefix?.some((row) => row.contract_no === generatedContractNo)
    ? `${generatedContractNo}-${String(samePrefix.length + 1).padStart(2, "0")}`
    : generatedContractNo;

  const { data, error } = await supabase.rpc("create_sale_contract_rpc", {
    p_unit_id: input.unitId,
    p_customer_id: input.customerId,
    p_contract_no: contractNo,
    p_signed_date: input.signedDate,
    p_total_amount_xof: input.totalAmountXof,
    p_payment_plan_type: input.paymentPlanType,
    p_num_installments: input.numInstallments ?? null,
    p_transfer_date: input.transferDate ?? null,
    p_agency_company: input.agencyCompany ?? null,
    p_agent_name: input.agentName ?? null,
    p_agency_commission_xof: input.agencyCommissionXof ?? null,
    p_agency_commission_paid: input.agencyCommissionPaid ?? false,
    p_request_id: input.requestId,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/sales");
  revalidatePath("/fr/sales");
  const contractId = (data as { contract_id?: string } | null)?.contract_id;
  return { success: true, data: contractId ? ({ id: contractId } as SaleContractRow) : undefined };
}

/** Compatibility name: no second, nontransactional payment implementation. */
export async function recordSalePayment(input: Parameters<typeof recordSalePaymentAtomic>[0]) {
  return recordSalePaymentAtomic(input);
}
export async function addFlexibleInstallment(input: {
  contractId: string;
  installmentNo: number;
  dueDate: string;
  amountXof: number;
  requestId: string;
  expectedUpdatedAt: string;
}) {
  await guardSaleWrite();
  const { requestId, ...payload } = input;
  return submitFinanceOperation<SalePaymentScheduleRow>("sale_installment", payload, requestId);
}
export async function updateTransferStatus(
  contractId: string,
  status: string,
  transferDate: string | undefined,
  titleCertificateNo: string | undefined,
  requestId: string,
  expectedUpdatedAt: string,
) {
  await guardSaleWrite();
  return submitFinanceOperation(
    "sale_transfer",
    { contractId, status, transferDate, titleCertificateNo, expectedUpdatedAt },
    requestId,
  );
}
export async function terminateSaleContract(
  contractId: string,
  reason: string,
  requestId: string,
  expectedUpdatedAt: string,
) {
  await requireRole("admin");
  return submitFinanceOperation(
    "sale_terminate",
    { contractId, reason, expectedUpdatedAt },
    requestId,
  );
}
