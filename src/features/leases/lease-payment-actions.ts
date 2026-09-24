"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guardLeaseFinance } from "./lease-action-guards";
import type { CurrencyCode } from "@/types/domain";
import {
  buildLeaseFinancialReferencePrefix,
  getLeaseFinancialConfig,
  LEASE_FINANCIAL_BUSINESS_TYPES,
  type LeaseFinancialBusinessType,
} from "./lease-financial-entry-types";

export async function recordLeaseFinancialEntry(input: {
  contractId: string;
  businessType: LeaseFinancialBusinessType;
  paymentDate: string;
  amount: number;
  currency: CurrencyCode;
  exchangeRateToXof: number;
  paidThroughDate?: string;
  paymentMethod: "cash" | "check" | "bank_transfer" | "offset" | "other";
  externalReceiptNo?: string;
  notes?: string;
  requestId?: string;
}): Promise<{ success: boolean; referenceNo?: string; error?: string; warning?: string }> {
  await guardLeaseFinance();
  if (!LEASE_FINANCIAL_BUSINESS_TYPES.includes(input.businessType)) {
    return { success: false, error: "不支持的业务类型。" };
  }
  if (!input.paymentDate || !Number.isFinite(input.amount) || input.amount <= 0) {
    return { success: false, error: "请填写有效的日期和金额。" };
  }
  if (
    !Number.isFinite(input.exchangeRateToXof) ||
    (input.currency === "XOF" && input.exchangeRateToXof !== 1) ||
    (input.currency !== "XOF" && input.exchangeRateToXof <= 0)
  ) {
    return { success: false, error: "请填写有效的历史汇率；XOF 汇率必须为1。" };
  }
  if (!input.paymentMethod) {
    return { success: false, error: "请选择付款方式，系统不会自动默认为现金。" };
  }

  const config = getLeaseFinancialConfig(input.businessType);
  if (config.requiresPaidThrough && !input.paidThroughDate) {
    return { success: false, error: "租金收入必须填写已缴至日期。" };
  }

  const supabase = await createClient();
  const { data: contract, error: contractError } = await supabase
    .from("lease_contracts")
    .select("id, unit_id, customer_id, contract_no, paid_through_date, deposit_amount_xof")
    .eq("id", input.contractId)
    .single();
  if (contractError || !contract) return { success: false, error: "未找到对应长租合同。" };
  const requestId = input.requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc("record_lease_financial_entry_v2_rpc", {
    p_contract_id: contract.id,
    p_business_type: input.businessType,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_currency: input.currency,
    p_exchange_rate_to_xof: input.exchangeRateToXof,
    p_paid_through_date: input.paidThroughDate ?? null,
    p_payment_method: input.paymentMethod,
    p_notes: input.notes?.trim() || null,
    p_external_receipt_no: input.externalReceiptNo?.trim() || null,
    p_request_id: requestId,
  });
  if (error) return { success: false, error: error.message };
  const payload = data as { success?: boolean; reference_no?: string } | null;
  if (!payload?.success || !payload.reference_no)
    return { success: false, error: "财务记录保存失败。" };

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  revalidatePath("/finance");
  revalidatePath("/fr/finance");
  revalidatePath("/units");
  return { success: true, referenceNo: payload.reference_no };
}

export async function recordCombinedLeasePayment(input: {
  contractId: string;
  paymentDate: string;
  rentAmountXof: number;
  propertyAmountXof: number;
  paidThroughDate: string;
  paymentMethod: "cash" | "check" | "bank_transfer" | "offset" | "other";
  notes?: string;
  rentRequestId: string;
  propertyRequestId: string;
}): Promise<{ success: boolean; referenceNos?: string[]; error?: string; warning?: string }> {
  await guardLeaseFinance();
  if (
    !input.paymentDate ||
    !input.paidThroughDate ||
    !input.paymentMethod ||
    !Number.isFinite(input.rentAmountXof) ||
    !Number.isFinite(input.propertyAmountXof) ||
    input.rentAmountXof <= 0 ||
    input.propertyAmountXof <= 0
  ) {
    return { success: false, error: "组合收款必须包含有效的租金、物业费、付款方式和已缴至日期。" };
  }

  const supabase = await createClient();
  const { data: contract, error: contractError } = await supabase
    .from("lease_contracts")
    .select("id, contract_no, unit:units(unit_no, building:buildings(code))")
    .eq("id", input.contractId)
    .eq("status", "active")
    .single();
  if (contractError || !contract) return { success: false, error: "未找到对应生效长租合同。" };

  const unit = Array.isArray(contract.unit) ? contract.unit[0] : contract.unit;
  const building = Array.isArray(unit?.building) ? unit.building[0] : unit?.building;
  const rentPrefix = buildLeaseFinancialReferencePrefix(
    building?.code ?? "SACSI",
    unit?.unit_no ?? "UNIT",
    contract.contract_no,
    "rent_income",
    input.paymentDate,
  );
  const propertyPrefix = buildLeaseFinancialReferencePrefix(
    building?.code ?? "SACSI",
    unit?.unit_no ?? "UNIT",
    contract.contract_no,
    "property_fee_income",
    input.paymentDate,
  );

  const { data, error } = await supabase.rpc("record_combined_lease_payment_rpc", {
    p_contract_id: input.contractId,
    p_payment_date: input.paymentDate,
    p_rent_amount_xof: input.rentAmountXof,
    p_property_amount_xof: input.propertyAmountXof,
    p_paid_through_date: input.paidThroughDate,
    p_payment_method: input.paymentMethod,
    p_notes: input.notes?.trim() || null,
    p_rent_reference_prefix: rentPrefix,
    p_property_reference_prefix: propertyPrefix,
    p_rent_request_id: input.rentRequestId,
    p_property_request_id: input.propertyRequestId,
  });
  if (error) return { success: false, error: error.message };
  const payload = data as {
    success?: boolean;
    rent?: { reference_no?: string };
    property_fee?: { reference_no?: string };
  } | null;
  if (!payload?.success) return { success: false, error: "组合收款保存失败。" };

  for (const path of ["/leases", "/fr/leases", "/finance", "/fr/finance", "/units", "/fr/units"])
    revalidatePath(path);
  return {
    success: true,
    referenceNos: [payload.rent?.reference_no, payload.property_fee?.reference_no].filter(
      (value): value is string => Boolean(value),
    ),
  };
}
