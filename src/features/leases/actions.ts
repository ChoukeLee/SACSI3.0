"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuth, requireRole } from "@/lib/auth";
import type { LeaseContractRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";

// ── Create contract ──

export async function createLeaseContract(input: {
  unitId: string;
  customerId: string;
  contractNo: string;
  startDate: string;
  expectedEndDate: string;
  paymentCycle: string;
  paymentDay: number;
  monthlyRentXof: number;
  depositAmountXof: number;
  depositReceived: boolean;
  rentFreeDays: number;
  signerName?: string;
  status?: ContractStatus;
}): Promise<{ success: boolean; data?: LeaseContractRow; error?: string }> {
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

  // Check active contract on this unit
  const { data: existing } = await supabase
    .from("lease_contracts")
    .select("id, contract_no")
    .eq("unit_id", input.unitId)
    .eq("status", "active")
    .limit(1);
  if (existing && existing.length > 0) {
    return {
      success: false,
      error: `This unit already has an active lease (${existing[0].contract_no}).`,
    };
  }

  const targetStatus: ContractStatus = input.status ?? "draft";

  const { data, error } = await supabase
    .from("lease_contracts")
    .insert({
      unit_id: input.unitId,
      customer_id: input.customerId,
      contract_no: input.contractNo.trim(),
      start_date: input.startDate,
      expected_end_date: input.expectedEndDate,
      payment_cycle: input.paymentCycle,
      payment_day: input.paymentDay,
      monthly_rent_xof: input.monthlyRentXof,
      deposit_amount_xof: input.depositAmountXof,
      deposit_received: input.depositReceived,
      rent_free_days: input.rentFreeDays,
      signer_name: input.signerName ?? null,
      status: targetStatus,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { success: false, error: "Contract number already exists." };
    }
    return { success: false, error: error.message };
  }

  // If active, update unit status
  if (targetStatus === "active") {
    await supabase.from("units").update({ status: "leased" }).eq("id", input.unitId);
  }

  // If deposit received, record payment + ledger
  if (input.depositReceived && input.depositAmountXof > 0) {
    const { data: payment } = await supabase
      .from("payments")
      .insert({
        customer_id: input.customerId,
        unit_id: input.unitId,
        source_type: "lease_deposit",
        source_id: data.id,
        payment_date: input.startDate,
        amount: input.depositAmountXof,
        currency: "XOF",
        exchange_rate_to_xof: 1,
      })
      .select("id")
      .single();

    await supabase.from("ledger_entries").insert({
      unit_id: input.unitId,
      payment_id: payment?.id,
      entry_date: input.startDate,
      direction: "liability_in",
      category: "lease_deposit",
      amount_xof: input.depositAmountXof,
      description: `押金 lease=${data.id}`,
    });
  }

  await supabase.from("audit_logs").insert({
    action: "create",
    entity_type: "lease_contract",
    entity_id: data.id,
    metadata: { contract_no: input.contractNo, unit_id: input.unitId },
  });

  revalidatePath("/leases");
  revalidatePath("/fr/leases");

  return { success: true, data };
}

// ── Status transitions ──

export async function activateContract(
  contractId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("lease_contracts")
    .select("id, unit_id")
    .eq("id", contractId)
    .eq("status", "draft")
    .single();
  if (!contract) return { success: false, error: "Contract not found or not in draft status." };

  // Re-check no other active contract on this unit
  const { data: conflict } = await supabase
    .from("lease_contracts")
    .select("id")
    .eq("unit_id", contract.unit_id)
    .eq("status", "active")
    .neq("id", contractId)
    .limit(1);
  if (conflict && conflict.length > 0) {
    return { success: false, error: "Unit already has an active lease." };
  }

  await supabase.from("lease_contracts").update({ status: "active" }).eq("id", contractId);
  await supabase.from("units").update({ status: "leased" }).eq("id", contract.unit_id);

  await supabase.from("audit_logs").insert({
    action: "activate",
    entity_type: "lease_contract",
    entity_id: contractId,
    metadata: {},
  });

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  return { success: true };
}

export async function terminateContract(
  contractId: string
): Promise<{ success: boolean; error?: string }> {
  await requireRole("admin");
  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("lease_contracts")
    .select("id, unit_id")
    .eq("id", contractId)
    .eq("status", "active")
    .single();
  if (!contract) return { success: false, error: "Contract not found or not active." };

  await supabase
    .from("lease_contracts")
    .update({ status: "terminated", actual_end_date: new Date().toISOString().slice(0, 10) })
    .eq("id", contractId);
  await supabase.from("units").update({ status: "available" }).eq("id", contract.unit_id);

  await supabase.from("audit_logs").insert({
    action: "terminate",
    entity_type: "lease_contract",
    entity_id: contractId,
    metadata: {},
  });

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  return { success: true };
}

// ── Rent payment ──

export async function recordRentPayment(input: {
  contractId: string;
  amount: number;
  paymentDate: string;
  receiptNo?: string;
  coveringMonths?: number;
}): Promise<{ success: boolean; error?: string }> {
  if (input.amount <= 0) {
    return { success: false, error: "Amount must be positive." };
  }

  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("lease_contracts")
    .select("id, unit_id, customer_id, monthly_rent_xof")
    .eq("id", input.contractId)
    .single();
  if (!contract) return { success: false, error: "Contract not found." };

  // Record payment
  const { data: payment } = await supabase
    .from("payments")
    .insert({
      customer_id: contract.customer_id,
      unit_id: contract.unit_id,
      source_type: "lease_rent",
      source_id: input.contractId,
      payment_date: input.paymentDate,
      amount: input.amount,
      currency: "XOF",
      exchange_rate_to_xof: 1,
      receipt_no: input.receiptNo ?? null,
    })
    .select("id")
    .single();

  // Ledger entry
  await supabase.from("ledger_entries").insert({
    unit_id: contract.unit_id,
    payment_id: payment?.id,
    entry_date: input.paymentDate,
    direction: "income",
    category: "lease_rent",
    amount_xof: input.amount,
    description: `长租租金 lease=${input.contractId}${input.coveringMonths ? ` (${input.coveringMonths}个月)` : ""}`,
  });

  await supabase.from("audit_logs").insert({
    action: "payment",
    entity_type: "lease_contract",
    entity_id: input.contractId,
    metadata: { amount: input.amount, date: input.paymentDate, receipt_no: input.receiptNo },
  });

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  return { success: true };
}

// ── Move-out settlement ──

export async function processMoveOut(input: {
  contractId: string;
  actualEndDate: string;
  unpaidRentXof: number;
  utilityCleared: boolean;
  depositDeductionXof: number;
  depositRefundXof: number;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("lease_contracts")
    .select("id, unit_id, customer_id, deposit_amount_xof")
    .eq("id", input.contractId)
    .in("status", ["active", "expired"])
    .single();
  if (!contract) return { success: false, error: "Contract not found or cannot be settled." };

  // Collect unpaid rent if any
  if (input.unpaidRentXof > 0) {
    const { data: payment } = await supabase
      .from("payments")
      .insert({
        customer_id: contract.customer_id,
        unit_id: contract.unit_id,
        source_type: "lease_rent",
        source_id: input.contractId,
        payment_date: input.actualEndDate,
        amount: input.unpaidRentXof,
        currency: "XOF",
        exchange_rate_to_xof: 1,
      })
      .select("id")
      .single();

    await supabase.from("ledger_entries").insert({
      unit_id: contract.unit_id,
      payment_id: payment?.id,
      entry_date: input.actualEndDate,
      direction: "income",
      category: "lease_rent",
      amount_xof: input.unpaidRentXof,
      description: `退租结算未付租金 lease=${input.contractId}`,
    });
  }

  // Refund deposit (partial or full)
  if (input.depositRefundXof > 0) {
    await supabase.from("ledger_entries").insert({
      unit_id: contract.unit_id,
      entry_date: input.actualEndDate,
      direction: "liability_out",
      category: "lease_deposit",
      amount_xof: input.depositRefundXof,
      description: `退还押金 lease=${input.contractId}${input.depositDeductionXof > 0 ? ` (扣除 ${input.depositDeductionXof})` : ""}`,
    });
  }

  // Update contract
  await supabase
    .from("lease_contracts")
    .update({
      status: "terminated",
      actual_end_date: input.actualEndDate,
    })
    .eq("id", input.contractId);

  // Update unit status
  await supabase.from("units").update({ status: "available" }).eq("id", contract.unit_id);

  await supabase.from("audit_logs").insert({
    action: "move_out",
    entity_type: "lease_contract",
    entity_id: input.contractId,
    metadata: {
      actual_end_date: input.actualEndDate,
      unpaid_rent: input.unpaidRentXof,
      deposit_deduction: input.depositDeductionXof,
      deposit_refund: input.depositRefundXof,
      utility_cleared: input.utilityCleared,
    },
  });

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  return { success: true };
}

// ── Overdue reminders ──

export async function generateOverdueReminders(
  buildingId: string
): Promise<{ success: boolean; count: number }> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekLater = new Date();
  weekLater.setDate(weekLater.getDate() + 7);
  const weekLaterStr = weekLater.toISOString().slice(0, 10);

  // Find contracts whose payment_day falls within next 7 days or past due
  const { data: contracts } = await supabase
    .from("lease_contracts")
    .select("id, unit_id, customer_id, contract_no, payment_day, expected_end_date")
    .eq("status", "active");

  if (!contracts) return { success: true, count: 0 };

  const todayDay = new Date().getDate();
  let count = 0;

  for (const contract of contracts) {
    const paymentDay = contract.payment_day;
    // Check if overdue (today's day > paymentDay means this month's payment missed)
    const isOverdue = todayDay > paymentDay;
    // Check if due within 7 days
    const diff = paymentDay - todayDay;
    const isDueSoon = diff >= 0 && diff <= 7;

    if (isOverdue || isDueSoon) {
      const title = isOverdue
        ? `租金逾期提醒 — ${contract.contract_no}`
        : `租金即将到期 — ${contract.contract_no}`;
      const body = isOverdue
        ? `合同 ${contract.contract_no} 本月付款日 ${paymentDay} 号已过，请尽快催缴。`
        : `合同 ${contract.contract_no} 付款日 ${paymentDay} 号，还有 ${diff} 天。`;

      await supabase.from("notifications").insert({
        building_id: buildingId,
        title,
        body,
        channel: "in_app",
        due_at: isOverdue ? today : weekLaterStr,
      });
      count++;
    }
  }

  return { success: true, count };
}
