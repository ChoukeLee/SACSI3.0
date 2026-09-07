import "server-only";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type { AiProposalDraft } from "@/features/business-actions/ai-draft-model";
import { planLeaseFinancialAllocation } from "./financial-draft";

export type ReceiptPaymentMethod = "cash" | "check" | "bank_transfer" | "offset" | "other";

export interface ReceiptProposalFields {
  buildingCode: string;
  roomNo: string;
  amountXof: number;
  receiptDate: string;
  paidThroughDate: string | null;
  payerName: string | null;
  notes: string | null;
  paymentMethod: ReceiptPaymentMethod;
  businessHint: "rent" | "property_fee" | null;
}

export interface ReceiptProposalBuild {
  draft: AiProposalDraft;
  fields: ReceiptProposalFields;
  match: { building: string; roomNo: string; contractNo: string; currentPaidThrough: string | null };
  plan: { kind: string; rentAmountXof: number; propertyAmountXof: number; confidence: number; warnings: string[] };
}

const PAYMENT_METHODS = new Set<ReceiptPaymentMethod>(["cash", "check", "bank_transfer", "offset", "other"]);

export function validateReceiptProposalFields(input: ReceiptProposalFields) {
  const fields: ReceiptProposalFields = {
    buildingCode: input.buildingCode.trim().toUpperCase(),
    roomNo: input.roomNo.trim().toUpperCase(),
    amountXof: Number(input.amountXof),
    receiptDate: input.receiptDate,
    paidThroughDate: input.paidThroughDate || null,
    payerName: input.payerName?.trim().slice(0, 200) || null,
    notes: input.notes?.trim().slice(0, 1000) || null,
    paymentMethod: input.paymentMethod,
    businessHint: input.businessHint === "rent" || input.businessHint === "property_fee" ? input.businessHint : null,
  };
  if (!/^SACSI\d{1,2}$/.test(fields.buildingCode) || !/^[A-Z0-9-]{1,20}$/.test(fields.roomNo)
    || !/^20\d{2}-\d{2}-\d{2}$/.test(fields.receiptDate) || (fields.paidThroughDate && !/^20\d{2}-\d{2}-\d{2}$/.test(fields.paidThroughDate))
    || !Number.isFinite(fields.amountXof) || fields.amountXof <= 0 || !PAYMENT_METHODS.has(fields.paymentMethod)) {
    throw new Error("楼栋、房号、付款日期、金额和付款方式均为必填，且格式必须有效。");
  }
  return fields;
}

export async function buildLeaseReceiptProposal(input: ReceiptProposalFields): Promise<ReceiptProposalBuild> {
  const fields = validateReceiptProposalFields(input);
  const supabase = await createClient();
  const { data: building, error: buildingError } = await supabase.from("buildings").select("id, code, display_name").eq("code", fields.buildingCode).eq("is_active", true).single();
  if (buildingError || !building) throw new Error("未找到指定楼栋。");
  const { data: unit, error: unitError } = await supabase.from("units").select("id, unit_no, updated_at").eq("building_id", building.id).eq("unit_no", fields.roomNo).single();
  if (unitError || !unit) throw new Error("未找到指定房间。");
  const { data: contract, error: contractError } = await supabase
    .from("lease_contracts")
    .select("id, customer_id, contract_no, monthly_rent_xof, paid_through_date, updated_at")
    .eq("unit_id", unit.id)
    .eq("status", "active")
    .single();
  if (contractError || !contract) throw new Error("该房间没有唯一的生效长租合同，不能自动入账。");

  const { data: receivables, error: receivableError } = await supabase
    .from("receivables")
    .select("id, category, amount_xof, paid_amount_xof, due_date, status, management_status")
    .eq("source_type", "lease_contract")
    .eq("source_id", contract.id)
    .eq("management_status", "managed")
    .neq("status", "cancelled");
  if (receivableError) throw new Error(receivableError.message);
  const outstanding = (category: string) => (receivables ?? [])
    .filter((row) => row.category === category)
    .reduce((sum, row) => sum + Math.max(0, Number(row.amount_xof) - Number(row.paid_amount_xof)), 0);
  const rentOutstandingXof = outstanding("lease_rent");
  const propertyOutstandingXof = outstanding("property_fee");
  const plan = planLeaseFinancialAllocation({
    totalAmountXof: fields.amountXof,
    rentOutstandingXof,
    propertyOutstandingXof,
    hint: fields.businessHint,
  });
  if (plan.kind === "needs_review") throw new Error(plan.warnings.join("；"));
  if ((plan.kind === "rent" || plan.kind === "combined") && !fields.paidThroughDate) {
    throw new Error("租金收款必须确认已缴至日期。");
  }

  const action = plan.kind === "rent" ? "record_lease_rent" : plan.kind === "property_fee" ? "record_property_fee" : "record_combined_lease_payment";
  const draft: AiProposalDraft = {
    action,
    target: { buildingId: building.id, unitId: unit.id, leaseContractId: contract.id, customerId: contract.customer_id },
    input: {
      paymentDate: fields.receiptDate,
      paidThroughDate: fields.paidThroughDate,
      paymentMethod: fields.paymentMethod,
      payerName: fields.payerName,
      notes: fields.notes,
      totalAmountXof: fields.amountXof,
      rentAmountXof: plan.rentAmountXof,
      propertyAmountXof: plan.propertyAmountXof,
      businessRequestId: randomUUID(),
      rentRequestId: randomUUID(),
      propertyRequestId: randomUUID(),
    },
    beforeSnapshot: {
      buildingCode: fields.buildingCode,
      roomNo: fields.roomNo,
      contractNo: contract.contract_no,
      paidThroughDate: contract.paid_through_date,
      rentOutstandingXof,
      propertyOutstandingXof,
    },
    beforeVersions: {},
    expectedEffects: [
      { entityType: "payment", operation: "insert", summary: `登记 ${fields.amountXof} XOF 收款` },
      { entityType: "ledger_entry", operation: "insert", summary: "写入对应财务流水" },
      { entityType: "receivable", operation: "update", summary: "按现有应收匹配并更新余额" },
    ],
    warnings: plan.warnings,
    confidence: plan.confidence,
  };
  return {
    draft,
    fields,
    match: { building: building.display_name || building.code, roomNo: fields.roomNo, contractNo: contract.contract_no, currentPaidThrough: contract.paid_through_date },
    plan,
  };
}
