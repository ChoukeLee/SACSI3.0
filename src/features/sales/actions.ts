"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { SaleContractRow, SalePaymentScheduleRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";
import {
  createReceivable, syncReceivablesForSource, cancelReceivablesForSource,
} from "@/features/finance/receivables";

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
}): Promise<{ success: boolean; data?: SaleContractRow; error?: string }> {
  const supabase = await createClient();

  if (!input.contractNo.trim()) {
    return { success: false, error: "Contract number is required." };
  }

  // Check blacklist
  const { data: customer } = await supabase
    .from("customers")
    .select("is_blacklisted, blacklist_reason")
    .eq("id", input.customerId)
    .single();
  if (customer?.is_blacklisted) {
    return { success: false, error: `Customer is blacklisted: ${customer.blacklist_reason}` };
  }

  // Insert contract
  const { data: contract, error } = await supabase
    .from("sale_contracts")
    .insert({
      unit_id: input.unitId,
      customer_id: input.customerId,
      contract_no: input.contractNo.trim(),
      signed_date: input.signedDate,
      transfer_date: input.transferDate ?? null,
      transfer_status: "not_started",
      title_certificate_no: null,
      agency_company: input.agencyCompany ?? null,
      agent_name: input.agentName ?? null,
      agency_commission_amount_xof: input.agencyCommissionXof ?? null,
      agency_commission_paid: input.agencyCommissionPaid ?? false,
      payment_plan_type: input.paymentPlanType,
      total_amount_xof: input.totalAmountXof,
      status: "active",
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return { success: false, error: "Contract number already exists." };
    return { success: false, error: error.message };
  }

  // Generate payment schedule
  const schedule = buildSchedule(contract.id, input);
  if (schedule.length > 0) {
    await supabase.from("sale_payment_schedule").insert(schedule);
  }

  // Update unit status to sold
  await supabase.from("units").update({ status: "sold" }).eq("id", input.unitId);

  // Create receivables from the payment schedule
  const { data: unit } = await supabase.from("units").select("building_id").eq("id", input.unitId).single();
  for (const inst of schedule) {
    const category = input.paymentPlanType === "lump_sum" ? "sale_lump_sum" as const : "sale_installment" as const;
    await createReceivable({
      building_id: unit?.building_id ?? null,
      unit_id: input.unitId,
      customer_id: input.customerId,
      source_type: "sale_contract",
      source_id: contract.id,
      category,
      title: `出售 ${input.contractNo} #${inst.installment_no}`,
      due_date: inst.due_date,
      amount_xof: inst.amount_xof,
      paid_amount_xof: 0,
      status: "pending",
      currency: "XOF",
    });
  }

  await supabase.from("audit_logs").insert({
    action: "create",
    entity_type: "sale_contract",
    entity_id: contract.id,
    metadata: { contract_no: input.contractNo, payment_plan: input.paymentPlanType },
  });

  revalidatePath("/sales");
  revalidatePath("/fr/sales");
  return { success: true, data: contract };
}

function buildSchedule(
  contractId: string,
  input: { paymentPlanType: string; totalAmountXof: number; numInstallments?: number; signedDate: string }
) {
  const schedule: { sale_contract_id: string; installment_no: number; due_date: string; amount_xof: number; status: string }[] = [];

  if (input.paymentPlanType === "lump_sum") {
    schedule.push({
      sale_contract_id: contractId,
      installment_no: 1,
      due_date: input.signedDate,
      amount_xof: input.totalAmountXof,
      status: "pending",
    });
  } else if (input.paymentPlanType === "fixed_installment" && input.numInstallments && input.numInstallments > 1) {
    const perInstallment = Math.round(input.totalAmountXof / input.numInstallments);
    let remainder = input.totalAmountXof - perInstallment * input.numInstallments;
    const startDate = new Date(input.signedDate);
    for (let i = 0; i < input.numInstallments; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + (i + 1) * 1);
      let amount = perInstallment;
      if (i === input.numInstallments - 1 && remainder !== 0) {
        amount += remainder;
        remainder = 0;
      }
      schedule.push({
        sale_contract_id: contractId,
        installment_no: i + 1,
        due_date: dueDate.toISOString().slice(0, 10),
        amount_xof: amount,
        status: "pending",
      });
    }
  }
  // For flexible, installments are added manually by the user later

  return schedule;
}

// ── Record payment ──

export async function recordSalePayment(input: {
  contractId: string;
  scheduleId: string;
  amount: number;
  paymentDate: string;
  receiptNo?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (input.amount <= 0) return { success: false, error: "Amount must be positive." };

  const supabase = await createClient();

  const { data: schedule } = await supabase
    .from("sale_payment_schedule")
    .select("id, sale_contract_id, installment_no, amount_xof, status")
    .eq("id", input.scheduleId)
    .single();
  if (!schedule) return { success: false, error: "Installment not found." };

  const { data: contract } = await supabase
    .from("sale_contracts")
    .select("id, unit_id, customer_id")
    .eq("id", input.contractId)
    .single();
  if (!contract) return { success: false, error: "Contract not found." };

  // Update schedule status
  await supabase
    .from("sale_payment_schedule")
    .update({ status: "paid" })
    .eq("id", input.scheduleId);

  // Record payment
  const { data: payment } = await supabase
    .from("payments")
    .insert({
      customer_id: contract.customer_id,
      unit_id: contract.unit_id,
      source_type: "sale",
      source_id: input.contractId,
      payment_date: input.paymentDate,
      amount: input.amount,
      currency: "XOF",
      exchange_rate_to_xof: 1,
      receipt_no: input.receiptNo ?? null,
    })
    .select("id")
    .single();

  // Ledger
  await supabase.from("ledger_entries").insert({
    unit_id: contract.unit_id,
    payment_id: payment?.id,
    entry_date: input.paymentDate,
    direction: "income",
    category: "sale",
    amount_xof: input.amount,
    description: `出售收款 sale=${input.contractId} installment=${schedule.installment_no}`,
  });

  await supabase.from("audit_logs").insert({
    action: "payment",
    entity_type: "sale_contract",
    entity_id: input.contractId,
    metadata: { amount: input.amount, schedule_id: input.scheduleId, receipt_no: input.receiptNo },
  });

  await syncReceivablesForSource("sale_contract", input.contractId);

  revalidatePath("/sales");
  revalidatePath("/fr/sales");
  return { success: true };
}

// ── Add flexible installment ──

export async function addFlexibleInstallment(input: {
  contractId: string;
  installmentNo: number;
  dueDate: string;
  amountXof: number;
}): Promise<{ success: boolean; data?: SalePaymentScheduleRow; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sale_payment_schedule")
    .insert({
      sale_contract_id: input.contractId,
      installment_no: input.installmentNo,
      due_date: input.dueDate,
      amount_xof: input.amountXof,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) return { success: false, error: error.message };

  // Create receivable for this flexible installment
  const { data: contract } = await supabase.from("sale_contracts")
    .select("unit_id, customer_id, contract_no").eq("id", input.contractId).single();
  if (contract) {
    const { data: unit } = await supabase.from("units").select("building_id").eq("id", contract.unit_id).single();
    await createReceivable({
      building_id: unit?.building_id ?? null,
      unit_id: contract.unit_id,
      customer_id: contract.customer_id,
      source_type: "sale_contract",
      source_id: input.contractId,
      category: "sale_installment",
      title: `出售 ${contract.contract_no} #${input.installmentNo}`,
      due_date: input.dueDate,
      amount_xof: input.amountXof,
      paid_amount_xof: 0,
      status: "pending",
      currency: "XOF",
    });
  }

  revalidatePath("/sales");
  revalidatePath("/fr/sales");
  return { success: true, data };
}

// ── Update transfer status ──

export async function updateTransferStatus(
  contractId: string,
  status: string,
  transferDate?: string,
  titleCertificateNo?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const update: Record<string, unknown> = { transfer_status: status };
  if (transferDate) update.transfer_date = transferDate;
  if (titleCertificateNo) update.title_certificate_no = titleCertificateNo;

  const { error } = await supabase
    .from("sale_contracts")
    .update(update)
    .eq("id", contractId);
  if (error) return { success: false, error: error.message };

  await supabase.from("audit_logs").insert({
    action: "transfer_update",
    entity_type: "sale_contract",
    entity_id: contractId,
    metadata: { transfer_status: status },
  });

  revalidatePath("/sales");
  revalidatePath("/fr/sales");
  return { success: true };
}

// ── Terminate contract (buyer default) ──

export async function terminateSaleContract(
  contractId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  await requireRole("admin");
  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("sale_contracts")
    .select("id, unit_id")
    .eq("id", contractId)
    .eq("status", "active")
    .single();
  if (!contract) return { success: false, error: "Contract not found or not active." };

  await supabase
    .from("sale_contracts")
    .update({ status: "terminated" })
    .eq("id", contractId);

  // Restore unit to available
  await supabase.from("units").update({ status: "available" }).eq("id", contract.unit_id);

  await supabase.from("audit_logs").insert({
    action: "terminate",
    entity_type: "sale_contract",
    entity_id: contractId,
    metadata: { reason },
  });

  await cancelReceivablesForSource("sale_contract", contractId);

  revalidatePath("/sales");
  revalidatePath("/fr/sales");
  return { success: true };
}
