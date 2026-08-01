"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { computeStatus } from "@/lib/repositories/receivable-repo";
import type { SaleContractRow, SalePaymentScheduleRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";
import { buildSaleContractNumber } from "@/lib/contract-number";
import {
  createReceivable, cancelReceivablesForSource,
} from "@/features/finance/receivables";

// ── Permission guards ──
async function guardSaleWrite() {
  await requireRole("admin", "rental_sales");
}
async function guardSaleFinance() { await requireRole("admin", "finance"); }

export async function recordSalePaymentAtomic(input: {
  contractId: string;
  scheduleId: string;
  amount: number;
  paymentDate: string;
  receiptNo?: string;
  requestId: string;
}): Promise<{ success: boolean; error?: string }> {
  await guardSaleFinance();
  if (!input.requestId || !input.paymentDate || input.amount <= 0) {
    return { success: false, error: "Invalid payment request." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_sale_payment_rpc", {
    p_contract_id: input.contractId,
    p_schedule_id: input.scheduleId,
    p_amount: input.amount,
    p_payment_date: input.paymentDate,
    p_receipt_no: input.receiptNo ?? null,
    p_request_id: input.requestId,
  });
  if (error) return { success: false, error: error.message };
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
    .select("unit_no, building:buildings(code)")
    .eq("id", input.unitId)
    .single();
  if (unitError || !contractUnit) return { success: false, error: unitError?.message ?? "Unit not found." };
  const contractBuilding = Array.isArray(contractUnit.building) ? contractUnit.building[0] : contractUnit.building;
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

// ── Find matching receivable for a schedule ──

async function findMatchingReceivable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contractId: string,
  schedule: { due_date: string; amount_xof: number },
  category: string,
) {
  const { data } = await supabase
    .from("receivables")
    .select("*")
    .eq("source_type", "sale_contract")
    .eq("source_id", contractId)
    .eq("category", category)
    .eq("due_date", schedule.due_date)
    .eq("amount_xof", schedule.amount_xof)
    .neq("status", "cancelled")
    .limit(1);
  return data?.[0] ?? null;
}

// ── Sync overdue statuses for a contract ──

export async function syncSaleOverdueStatuses(contractId: string) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Sync receivables
  const { data: receivables } = await supabase
    .from("receivables")
    .select("*")
    .eq("source_type", "sale_contract")
    .eq("source_id", contractId)
    .neq("status", "cancelled");

  if (receivables) {
    for (const r of receivables) {
      const newStatus = computeStatus(Number(r.amount_xof), Number(r.paid_amount_xof), r.due_date);
      if (newStatus !== r.status) {
        await supabase.from("receivables").update({ status: newStatus }).eq("id", r.id);
      }
    }
  }

  // Sync schedules
  const { data: schedules } = await supabase
    .from("sale_payment_schedule")
    .select("*")
    .eq("sale_contract_id", contractId)
    .neq("status", "cancelled");

  if (schedules) {
    for (const s of schedules) {
      const cat = s.installment_no === 1
        ? (await supabase.from("sale_contracts").select("payment_plan_type").eq("id", contractId).single()).data?.payment_plan_type === "lump_sum" ? "sale_lump_sum" : "sale_installment"
        : "sale_installment";

      const rec = await findMatchingReceivable(supabase, contractId, s, cat);
      if (rec) {
        const newScheduleStatus = rec.status === "paid" ? "paid"
          : rec.status === "partial" ? "pending"
          : rec.status === "overdue" ? "overdue"
          : s.status;
        if (newScheduleStatus !== s.status && newScheduleStatus !== "pending") {
          await supabase.from("sale_payment_schedule").update({ status: newScheduleStatus }).eq("id", s.id);
        }
      } else if (s.due_date < today && s.status === "pending") {
        await supabase.from("sale_payment_schedule").update({ status: "overdue" }).eq("id", s.id);
      }
    }
  }
}

// ── Record payment ──

export async function recordSalePayment(input: {
  contractId: string;
  scheduleId: string;
  amount: number;
  paymentDate: string;
  receiptNo?: string;
}): Promise<{ success: boolean; error?: string }> {
  await guardSaleFinance();
  if (input.amount <= 0) return { success: false, error: "Amount must be positive." };

  const supabase = await createClient();

  const { data: schedule } = await supabase
    .from("sale_payment_schedule")
    .select("id, sale_contract_id, installment_no, amount_xof, status, due_date")
    .eq("id", input.scheduleId)
    .single();
  if (!schedule) return { success: false, error: "Installment not found." };
  if (schedule.status === "paid") return { success: false, error: "This installment is already paid." };
  if (schedule.status === "cancelled") return { success: false, error: "This installment is cancelled." };

  const { data: contract } = await supabase
    .from("sale_contracts")
    .select("id, unit_id, customer_id, payment_plan_type, contract_no, unit:units(unit_no)")
    .eq("id", input.contractId)
    .single();
  if (!contract) return { success: false, error: "Contract not found." };
  const saleUnit = (contract as typeof contract & { unit?: { unit_no?: string } | null }).unit;
  const unitNo = saleUnit?.unit_no ?? "未设置";

  // Find matching receivable
  const category = contract.payment_plan_type === "lump_sum" ? "sale_lump_sum" : "sale_installment";
  const receivable = await findMatchingReceivable(supabase, input.contractId, schedule, category);

  // Validate against receivable unpaid amount
  if (receivable) {
    const unpaid = Number(receivable.amount_xof) - Number(receivable.paid_amount_xof);
    if (unpaid <= 0) return { success: false, error: "This receivable is already fully paid." };
    if (input.amount > unpaid) {
      return { success: false, error: `Amount exceeds outstanding (${unpaid}). Full payment required for each installment.` };
    }
  } else {
    // No receivable found — validate against schedule amount
    if (input.amount > Number(schedule.amount_xof)) {
      return { success: false, error: "Amount exceeds schedule amount." };
    }
  }

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
    description: `出售收款 房间${unitNo} 第${schedule.installment_no}期`,
  });

  // Update individual receivable directly (instead of bulk sync)
  if (receivable) {
    const newPaid = Number(receivable.paid_amount_xof) + input.amount;
    const newStatus = computeStatus(Number(receivable.amount_xof), newPaid, receivable.due_date);
    await supabase.from("receivables").update({
      paid_amount_xof: newPaid,
      status: newStatus,
    }).eq("id", receivable.id);

    // Sync schedule status from receivable status
    const scheduleStatus = newStatus === "paid" ? "paid"
      : newStatus === "overdue" ? "overdue"
      : "pending";
    await supabase.from("sale_payment_schedule").update({ status: scheduleStatus }).eq("id", input.scheduleId);
  } else {
    // Fallback: mark schedule as paid
    await supabase.from("sale_payment_schedule").update({ status: "paid" }).eq("id", input.scheduleId);
  }

  // Sync overdue statuses for the whole contract
  await syncSaleOverdueStatuses(input.contractId);

  await supabase.from("audit_logs").insert({
    action: "payment",
    entity_type: "sale_contract",
    entity_id: input.contractId,
    metadata: { amount: input.amount, schedule_id: input.scheduleId, receipt_no: input.receiptNo },
  });

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
  await guardSaleWrite();
  const supabase = await createClient();

  // Check for duplicate installment_no
  const { data: existing } = await supabase
    .from("sale_payment_schedule")
    .select("id")
    .eq("sale_contract_id", input.contractId)
    .eq("installment_no", input.installmentNo)
    .limit(1);
  if (existing && existing.length > 0) {
    return { success: false, error: `Installment #${input.installmentNo} already exists.` };
  }

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
      title: `出售分期 ${contract.contract_no} 第${input.installmentNo}期`,
      due_date: input.dueDate,
      amount_xof: input.amountXof,
      paid_amount_xof: 0,
      status: "pending",
      currency: "XOF",
    });
  }

  await supabase.from("audit_logs").insert({
    action: "add_installment",
    entity_type: "sale_contract",
    entity_id: input.contractId,
    metadata: { installment_no: input.installmentNo, amount: input.amountXof, due_date: input.dueDate },
  });

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
  await guardSaleWrite();
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

  // Cancel unpaid schedules
  await supabase
    .from("sale_payment_schedule")
    .update({ status: "cancelled" })
    .eq("sale_contract_id", contractId)
    .neq("status", "paid");

  // Cancel unpaid receivables
  await cancelReceivablesForSource("sale_contract", contractId);

  // Update contract status
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

  revalidatePath("/sales");
  revalidatePath("/fr/sales");
  return { success: true };
}
