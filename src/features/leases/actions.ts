"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { requireRole } from "@/lib/auth";
import { computeStatus } from "@/lib/repositories/receivable-repo";
import type { LeaseContractRow, ReceivableRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";
import {
  createReceivable, cancelReceivablesForSource,
} from "@/features/finance/receivables";
import {
  buildLeaseContractNumber,
  buildLeaseFinancialReferencePrefix,
  getLeaseFinancialConfig,
  LEASE_FINANCIAL_BUSINESS_TYPES,
  type LeaseFinancialBusinessType,
} from "./lease-financial-entry-types";

// ── Permission guards ──
async function guardLeaseWrite() {
  await requireRole("admin", "rental_sales");
}
async function guardLeaseFinance() { await requireRole("admin", "finance"); }

// ── Cycle multiplier ──
const CYCLE_MULTIPLIER: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

// ── Generate lease rent receivables ──

async function generateLeaseReceivables(
  contractId: string,
): Promise<{ success: boolean; count: number; existingCount?: number; error?: string }> {
  await guardLeaseWrite();
  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("lease_contracts")
    .select("*, unit:units(id, unit_no, building_id)")
    .eq("id", contractId)
    .single();
  if (!contract) return { success: false, count: 0, error: "未找到合同。" };

  const monthlyRent = Number(contract.monthly_rent_xof);
  const multiplier = CYCLE_MULTIPLIER[contract.payment_cycle] ?? 1;
  const amountXof = multiplier * monthlyRent;
  const startDate = new Date(contract.start_date);
  const endDate = new Date(contract.expected_end_date);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { success: false, count: 0, error: "合同日期无效。" };
  }

  // Get existing receivables for this contract to avoid duplicates
  const { data: existing } = await supabase
    .from("receivables")
    .select("due_date, category")
    .eq("source_type", "lease_contract")
    .eq("source_id", contractId)
    .eq("category", "lease_rent")
    .neq("status", "cancelled");
  const existingDueDates = new Set((existing ?? []).map(r => r.due_date));
  const existingCount = existing?.length ?? 0;

  const unit = (contract as any).unit as { id: string; unit_no: string; building_id: string } | null;
  const unitNo = unit?.unit_no ?? "";
  const buildingId = unit?.building_id ?? contract.unit?.building_id ?? null;
  const customerId = contract.customer_id as string;
  const unitId = contract.unit_id as string;

  let count = 0;
  let cursor = new Date(startDate);
  cursor.setDate(1); // normalize to first of month for iteration

  while (cursor <= endDate) {
    // Build the due_date: year-month-paymentDay (clamped to last day of month)
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const day = Math.min(contract.payment_day, lastDay);
    const dueDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    // Only insert if due_date is >= start_date and <= expected_end_date
    if (dueDate >= contract.start_date && dueDate <= contract.expected_end_date) {
      if (!existingDueDates.has(dueDate)) {
        await createReceivable({
          building_id: buildingId,
          unit_id: unitId,
          customer_id: customerId,
          source_type: "lease_contract",
          source_id: contractId,
          category: "lease_rent",
          title: `长租租金 ${unitNo} ${y}-${String(m + 1).padStart(2, "0")}`,
          due_date: dueDate,
          amount_xof: amountXof,
          paid_amount_xof: 0,
          status: "pending",
          currency: "XOF",
        });
        count++;
      }
    }

    // Advance cursor by cycle months
    cursor = new Date(y, m + multiplier, 1);
    // Safety break for very long contracts
    if (cursor.getFullYear() > startDate.getFullYear() + 50) break;
  }

  // Update statuses for past-due receivables
  await syncContractReceivableStatuses(contractId);

  await supabase.from("audit_logs").insert({
    action: "generate_receivables",
    entity_type: "lease_contract",
    entity_id: contractId,
    metadata: { count, payment_cycle: contract.payment_cycle, amount_xof: amountXof },
  });

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  return { success: true, count, existingCount };
}

/** Sync all receivable statuses for a contract based on current date. */
async function syncContractReceivableStatuses(contractId: string) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: receivables } = await supabase
    .from("receivables")
    .select("*")
    .eq("source_type", "lease_contract")
    .eq("source_id", contractId)
    .eq("category", "lease_rent")
    .neq("status", "cancelled");

  if (!receivables) return;

  for (const r of receivables) {
    const newStatus = computeStatus(Number(r.amount_xof), Number(r.paid_amount_xof), r.due_date);
    if (newStatus !== r.status) {
      await supabase.from("receivables").update({ status: newStatus }).eq("id", r.id);
    }
  }
}

async function ensureNextLeaseReceivable(contractId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createPrivilegedClient();
  const { data: contract, error: contractError } = await supabase
    .from("lease_contracts")
    .select("id, unit_id, customer_id, status, monthly_rent_xof, paid_through_date, unit:units(unit_no, building_id)")
    .eq("id", contractId)
    .single();
  if (contractError || !contract) return { success: false, error: contractError?.message ?? "未找到合同。" };
  if (contract.status !== "active" || !contract.paid_through_date) return { success: true };

  const { data: openRows, error: openError } = await supabase
    .from("receivables")
    .select("id, amount_xof, paid_amount_xof")
    .eq("source_type", "lease_contract")
    .eq("source_id", contract.id)
    .eq("category", "lease_rent")
    .in("status", ["pending", "partial", "overdue"]);
  if (openError) return { success: false, error: openError.message };
  if ((openRows ?? []).some((row) => Number(row.amount_xof) > Number(row.paid_amount_xof))) return { success: true };

  const due = new Date(`${contract.paid_through_date}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 1);
  const dueDate = due.toISOString().slice(0, 10);
  const { data: duplicate, error: duplicateError } = await supabase
    .from("receivables")
    .select("id")
    .eq("source_type", "lease_contract")
    .eq("source_id", contract.id)
    .eq("category", "lease_rent")
    .eq("due_date", dueDate)
    .neq("status", "cancelled")
    .limit(1);
  if (duplicateError) return { success: false, error: duplicateError.message };
  if (duplicate && duplicate.length > 0) return { success: true };

  const unit = Array.isArray(contract.unit) ? contract.unit[0] : contract.unit;
  const amountXof = Number(contract.monthly_rent_xof);
  const { error: insertError } = await supabase.from("receivables").insert({
    building_id: unit?.building_id ?? null,
    unit_id: contract.unit_id,
    customer_id: contract.customer_id,
    source_type: "lease_contract",
    source_id: contract.id,
    category: "lease_rent",
    title: `${unit?.unit_no ?? "-"} 长租下一期租金`,
    due_date: dueDate,
    amount_xof: amountXof,
    paid_amount_xof: 0,
    status: computeStatus(amountXof, 0, dueDate),
    currency: "XOF",
    notes: `根据租金已缴至日期 ${contract.paid_through_date} 自动生成`,
  });
  if (insertError && insertError.code !== "23505") return { success: false, error: insertError.message };
  return { success: true };
}

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
  await guardLeaseWrite();
  const supabase = await createClient();

  const { data: contractUnit } = await supabase
    .from("units")
    .select("unit_no, building:buildings(code)")
    .eq("id", input.unitId)
    .single();
  const contractBuilding = Array.isArray(contractUnit?.building) ? contractUnit.building[0] : contractUnit?.building;
  const generatedContractNo = buildLeaseContractNumber(
    contractBuilding?.code ?? "SACSI",
    contractUnit?.unit_no ?? "UNIT",
    input.startDate,
  );
  const requestedContractNo = generatedContractNo;
  const { data: samePrefix } = await supabase
    .from("lease_contracts")
    .select("contract_no")
    .like("contract_no", `${requestedContractNo}%`);
  const contractNo = samePrefix && samePrefix.some((row) => row.contract_no === requestedContractNo)
    ? `${requestedContractNo}-${String(samePrefix.length + 1).padStart(2, "0")}`
    : requestedContractNo;

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
      contract_no: contractNo,
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
      return { success: false, error: "合同编号已存在。" };
    }
    return { success: false, error: error.message };
  }

  // If active, update unit status and generate receivables
  if (targetStatus === "active") {
    const { data: unit } = await supabase.from("units").select("status").eq("id", input.unitId).single();
    if (unit?.status !== "sold") {
      await supabase.from("units").update({ status: "leased" }).eq("id", input.unitId);
    }
    // Generate rent receivables (don't block on failure)
    await generateLeaseReceivables(data.id);
  }

  // If deposit received, record payment + ledger + receivable
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

    const { data: depositUnit } = await supabase.from("units").select("unit_no").eq("id", input.unitId).single();
    await supabase.from("ledger_entries").insert({
      unit_id: input.unitId,
      payment_id: payment?.id,
      entry_date: input.startDate,
      direction: "liability_in",
      category: "lease_deposit",
      amount_xof: input.depositAmountXof,
      description: `长租押金 房间${depositUnit?.unit_no ?? "未设置"}`,
    });

    const { data: unit } = await supabase.from("units").select("building_id").eq("id", input.unitId).single();
    await createReceivable({
      building_id: unit?.building_id ?? null,
      unit_id: input.unitId,
      customer_id: input.customerId,
      source_type: "lease_contract",
      source_id: data.id,
      category: "lease_deposit",
      title: `押金 ${contractNo}`,
      due_date: input.startDate,
      amount_xof: input.depositAmountXof,
      paid_amount_xof: input.depositAmountXof,
      status: "paid",
      currency: "XOF",
    });
  }

  await supabase.from("audit_logs").insert({
    action: "create",
    entity_type: "lease_contract",
    entity_id: data.id,
    metadata: { contract_no: contractNo, unit_id: input.unitId, generated_contract_no: true },
  });

  revalidatePath("/leases");
  revalidatePath("/fr/leases");

  return { success: true, data };
}

export async function recordLeaseFinancialEntry(input: {
  contractId: string;
  businessType: LeaseFinancialBusinessType;
  paymentDate: string;
  amountXof: number;
  paidThroughDate?: string;
  paymentMethod?: "cash" | "check" | "bank_transfer" | "offset" | "other";
  notes?: string;
  requestId?: string;
}): Promise<{ success: boolean; referenceNo?: string; error?: string }> {
  await guardLeaseFinance();
  if (!LEASE_FINANCIAL_BUSINESS_TYPES.includes(input.businessType)) {
    return { success: false, error: "不支持的业务类型。" };
  }
  if (!input.paymentDate || !Number.isFinite(input.amountXof) || input.amountXof <= 0) {
    return { success: false, error: "请填写有效的日期和金额。" };
  }

  const config = getLeaseFinancialConfig(input.businessType);
  if (config.requiresPaidThrough && !input.paidThroughDate) {
    return { success: false, error: "租金收入必须填写已缴至日期。" };
  }

  const supabase = createPrivilegedClient();
  const { data: contract, error: contractError } = await supabase
    .from("lease_contracts")
    .select("id, unit_id, customer_id, contract_no, paid_through_date, deposit_amount_xof, unit:units(unit_no, building_id, building:buildings(code))")
    .eq("id", input.contractId)
    .single();
  if (contractError || !contract) return { success: false, error: "未找到对应长租合同。" };

  const unit = Array.isArray(contract.unit) ? contract.unit[0] : contract.unit;
  const building = Array.isArray(unit?.building) ? unit.building[0] : unit?.building;
  const referencePrefix = buildLeaseFinancialReferencePrefix(
    building?.code ?? "SACSI",
    unit?.unit_no ?? "UNIT",
    contract.contract_no,
    input.businessType,
    input.paymentDate,
  );
  const requestId = input.requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc("record_lease_financial_entry_rpc", {
    p_contract_id: contract.id,
    p_business_type: input.businessType,
    p_payment_date: input.paymentDate,
    p_amount_xof: input.amountXof,
    p_paid_through_date: input.paidThroughDate ?? null,
    p_payment_method: input.paymentMethod ?? "cash",
    p_notes: input.notes?.trim() || null,
    p_reference_prefix: referencePrefix,
    p_request_id: requestId,
  });
  if (error) return { success: false, error: error.message };
  const payload = data as { success?: boolean; reference_no?: string } | null;
  if (!payload?.success || !payload.reference_no) return { success: false, error: "财务记录保存失败。" };

  if (config.requiresPaidThrough && input.paidThroughDate) {
    const latestPaidThrough = !contract.paid_through_date || input.paidThroughDate > contract.paid_through_date
      ? input.paidThroughDate
      : contract.paid_through_date;
    const { error: endDateError } = await supabase
      .from("lease_contracts")
      .update({
        expected_end_date: latestPaidThrough,
        expected_end_confirmed: true,
      })
      .eq("id", contract.id);
    if (endDateError) return { success: false, error: "收款已保存，但合同到期日同步失败，请重试。" };

    const nextReceivable = await ensureNextLeaseReceivable(contract.id);
    if (!nextReceivable.success) {
      return { success: false, error: `收款已保存，但下一期应收生成失败：${nextReceivable.error ?? "未知错误"}` };
    }
  }

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  revalidatePath("/finance");
  revalidatePath("/fr/finance");
  revalidatePath("/units");
  return { success: true, referenceNo: payload.reference_no };
}

// ── Activate contract ──

export async function activateContract(
  contractId: string
): Promise<{ success: boolean; error?: string }> {
  await guardLeaseWrite();
  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("lease_contracts")
    .select("id, unit_id")
    .eq("id", contractId)
    .eq("status", "draft")
    .single();
  if (!contract) return { success: false, error: "未找到草稿状态的合同。" };

  // Re-check no other active contract on this unit
  const { data: conflict } = await supabase
    .from("lease_contracts")
    .select("id")
    .eq("unit_id", contract.unit_id)
    .eq("status", "active")
    .neq("id", contractId)
    .limit(1);
  if (conflict && conflict.length > 0) {
    return { success: false, error: "该房源已有生效中的长租合同。" };
  }

  await supabase.from("lease_contracts").update({ status: "active" }).eq("id", contractId);
  const { data: unit } = await supabase.from("units").select("status").eq("id", contract.unit_id).single();
  if (unit?.status !== "sold") {
    await supabase.from("units").update({ status: "leased" }).eq("id", contract.unit_id);
  }

  await supabase.from("audit_logs").insert({
    action: "activate",
    entity_type: "lease_contract",
    entity_id: contractId,
    metadata: {},
  });

  // Generate rent receivables
  const genResult = await generateLeaseReceivables(contractId);
  if (!genResult.success) {
    if (process.env.NODE_ENV === "development") {
      console.warn("generateLeaseReceivables failed:", genResult.error);
    }
  }

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  return { success: true };
}

// ── Terminate contract ──

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
  if (!contract) return { success: false, error: "未找到生效中的合同。" };

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

  await cancelReceivablesForSource("lease_contract", contractId);

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  return { success: true };
}

// ── Pay a specific receivable (full payment only) ──

async function recordReceivablePayment(input: {
  receivableId: string;
  paymentDate: string;
  receiptNo?: string;
}): Promise<{ success: boolean; error?: string }> {
  await guardLeaseFinance();

  const supabase = createPrivilegedClient();

  const { data: receivable } = await supabase
    .from("receivables")
    .select("*")
    .eq("id", input.receivableId)
    .single();
  if (!receivable) return { success: false, error: "未找到该应收。" };
  if (receivable.status === "cancelled") return { success: false, error: "该应收已取消。" };
  if (receivable.status === "paid") return { success: false, error: "该应收已付清。" };

  const outstanding = Number(receivable.amount_xof) - Number(receivable.paid_amount_xof);
  if (outstanding <= 0) return { success: false, error: "没有待收款项。" };

  const amount = outstanding;

  // Record payment
  const { data: payment } = await supabase
    .from("payments")
    .insert({
      customer_id: receivable.customer_id,
      unit_id: receivable.unit_id,
      source_type: receivable.source_type,
      source_id: receivable.source_id,
      payment_date: input.paymentDate,
      amount,
      currency: "XOF",
      exchange_rate_to_xof: 1,
      receipt_no: input.receiptNo ?? null,
    })
    .select("id")
    .single();

  const { data: unit } = receivable.unit_id
    ? await supabase.from("units").select("unit_no").eq("id", receivable.unit_id).single()
    : { data: null };
  const roomText = unit?.unit_no ? `房间${unit.unit_no}` : "未关联房间";

  // Ledger entry
  await supabase.from("ledger_entries").insert({
    building_id: receivable.building_id,
    unit_id: receivable.unit_id,
    payment_id: payment?.id,
    entry_date: input.paymentDate,
    direction: "income",
    category: receivable.category,
    amount_xof: amount,
    description: `${receivable.title} ${roomText}`,
  });

  // Update receivable
  const newPaid = Number(receivable.paid_amount_xof) + amount;
  const newStatus = computeStatus(Number(receivable.amount_xof), newPaid, receivable.due_date);
  await supabase
    .from("receivables")
    .update({ paid_amount_xof: newPaid, status: newStatus })
    .eq("id", receivable.id);

  await supabase.from("audit_logs").insert({
    action: "payment",
    entity_type: "receivable",
    entity_id: receivable.id,
    metadata: { amount, date: input.paymentDate, receipt_no: input.receiptNo },
  });

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  return { success: true };
}

// ── Legacy rent payment (kept for backward compat) ──

// ── Move-out settlement (enhanced) ──

export async function processMoveOut(input: {
  contractId: string;
  actualEndDate: string;
  unpaidRentXof: number;
  utilityCleared: boolean;
  depositDeductionXof: number;
  depositRefundXof: number;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  await guardLeaseFinance();
  const supabase = createPrivilegedClient();

  const { data: contract } = await supabase
    .from("lease_contracts")
    .select("id, unit_id, customer_id, deposit_amount_xof, deposit_received, unit:units(unit_no, building_id)")
    .eq("id", input.contractId)
    .in("status", ["active", "expired"])
    .single();
  if (!contract) return { success: false, error: "未找到可结算的合同。" };

  const depositAmount = Number(contract.deposit_amount_xof);
  const deduction = input.depositDeductionXof;
  const refund = Math.max(0, depositAmount - deduction);
  const totalDue = input.unpaidRentXof;
  const totalRefund = refund;
  const contractUnit = (contract as typeof contract & { unit?: { unit_no?: string; building_id?: string | null } | null }).unit;
  const unitNo = contractUnit?.unit_no ?? "未设置";

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
      description: `退租结算未付租金 房间${unitNo}`,
    });

    await createReceivable({
      building_id: contractUnit?.building_id ?? null,
      unit_id: contract.unit_id,
      customer_id: contract.customer_id,
      source_type: "lease_contract",
      source_id: input.contractId,
      category: "lease_rent",
      title: `退租结算 ${input.actualEndDate}`,
      due_date: input.actualEndDate,
      amount_xof: input.unpaidRentXof,
      paid_amount_xof: input.unpaidRentXof,
      status: "paid",
      currency: "XOF",
    });
  }

  // Refund deposit
  if (input.depositRefundXof > 0) {
    await supabase.from("ledger_entries").insert({
      unit_id: contract.unit_id,
      entry_date: input.actualEndDate,
      direction: "liability_out",
      category: "lease_deposit",
      amount_xof: input.depositRefundXof,
      description: `退还押金 房间${unitNo}${deduction > 0 ? ` 扣除${deduction}` : ""}`,
    });
  }

  // Deposit deduction → income
  if (deduction > 0) {
    await supabase.from("ledger_entries").insert({
      unit_id: contract.unit_id,
      entry_date: input.actualEndDate,
      direction: "income",
      category: "other_income",
      amount_xof: deduction,
      description: `押金扣除 房间${unitNo}`,
    });
  }

  // Write lease_settlements record
  await supabase.from("lease_settlements").insert({
    lease_contract_id: input.contractId,
    unit_id: contract.unit_id,
    customer_id: contract.customer_id,
    actual_end_date: input.actualEndDate,
    unpaid_rent_xof: input.unpaidRentXof,
    utility_cleared: input.utilityCleared,
    deposit_amount_xof: depositAmount,
    deposit_deduction_xof: deduction,
    deposit_refund_xof: refund,
    total_due_xof: totalDue,
    total_refund_xof: totalRefund,
    notes: input.notes ?? null,
  });

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

  // Cancel future unpaid lease_rent receivables
  const { data: futureReceivables } = await supabase
    .from("receivables")
    .select("id, amount_xof, paid_amount_xof, due_date, status")
    .eq("source_type", "lease_contract")
    .eq("source_id", input.contractId)
    .eq("category", "lease_rent")
    .neq("status", "cancelled");

  if (futureReceivables) {
    for (const r of futureReceivables) {
      if (r.due_date > input.actualEndDate) {
        const unpaid = Number(r.amount_xof) - Number(r.paid_amount_xof);
        if (unpaid > 0 || r.status !== "paid") {
          await supabase.from("receivables").update({
            status: "cancelled",
            notes: `合同退租 ${input.actualEndDate}，后续应收取消`,
          }).eq("id", r.id);
        }
      }
    }
  }

  await supabase.from("audit_logs").insert({
    action: "move_out",
    entity_type: "lease_contract",
    entity_id: input.contractId,
    metadata: {
      actual_end_date: input.actualEndDate,
      unpaid_rent: input.unpaidRentXof,
      deposit_deduction: deduction,
      deposit_refund: refund,
      utility_cleared: input.utilityCleared,
    },
  });

  revalidatePath("/leases");
  revalidatePath("/fr/leases");
  return { success: true };
}

// ── Overdue reminders ──

async function generateOverdueReminders(
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
    const isOverdue = todayDay > paymentDay;
    const diff = paymentDay - todayDay;
    const isDueSoon = diff >= 0 && diff <= 7;

    if (isOverdue || isDueSoon) {
      const title = isOverdue
        ? `租金逾期提醒 — ${contract.contract_no}`
        : `租金即将到期 — ${contract.contract_no}`;
      const body = isOverdue
        ? `合同 ${contract.contract_no} 本月付款日 ${paymentDay} 号已过，请尽快催缴。`
        : `合同 ${contract.contract_no} 付款日 ${paymentDay} 号，还有 ${diff} 天。`;

      // Check for existing notification to avoid duplicates
      const { data: existingNotif } = await supabase
        .from("notifications")
        .select("id")
        .eq("title", title)
        .gte("created_at", today)
        .limit(1);

      if (!existingNotif || existingNotif.length === 0) {
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
  }

  // Also check overdue receivables → generate notifications
  const { data: overdueReceivables } = await supabase
    .from("receivables")
    .select("id, title, due_date, unit_id, customer_id, contract:lease_contracts!inner(contract_no)")
    .eq("source_type", "lease_contract")
    .eq("category", "lease_rent")
    .neq("status", "cancelled")
    .neq("status", "paid")
    .lt("due_date", today);

  if (overdueReceivables) {
    for (const r of overdueReceivables) {
      const contractNo = (r as any).contract?.contract_no ?? "";
      const title = `租金逾期 — ${contractNo}`;
      const { data: existingNotif } = await supabase
        .from("notifications")
        .select("id")
        .eq("title", title)
        .gte("created_at", today)
        .limit(1);

      if (!existingNotif || existingNotif.length === 0) {
        await supabase.from("notifications").insert({
          building_id: buildingId,
          title,
          body: `应收 ${r.title} 逾期未付，截止日期 ${r.due_date}`,
          channel: "in_app",
          due_at: today,
        });
        count++;
      }
    }
  }

  return { success: true, count };
}

// ── Get receivables for a contract (read-only, used in UI) ──

async function getContractReceivables(
  contractId: string
): Promise<ReceivableRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("receivables")
    .select("*")
    .eq("source_type", "lease_contract")
    .eq("source_id", contractId)
    .order("due_date");
  return data ?? [];
}
