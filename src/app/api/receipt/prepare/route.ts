import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAiProposal } from "@/features/business-actions/ai-draft-service";
import { planLeaseFinancialAllocation } from "@/features/ai-workbench/financial-draft";

type PaymentMethod = "cash" | "check" | "bank_transfer" | "offset" | "other";
const PAYMENT_METHODS = new Set<PaymentMethod>(["cash", "check", "bank_transfer", "offset", "other"]);

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!hasPermission(user, "finance:write")) return NextResponse.json({ error: "Finance write permission required" }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const jobId = String(body.job_id ?? "");
    const buildingCode = String(body.building_code ?? "").trim().toUpperCase();
    const roomNo = String(body.room_no ?? "").trim().toUpperCase();
    const paymentDate = String(body.receipt_date ?? "");
    const paidThroughDate = body.period_end ? String(body.period_end) : null;
    const amountXof = Number(body.amount_xof);
    const paymentMethod = String(body.payment_method ?? "") as PaymentMethod;
    if (!jobId || !/^SACSI\d{1,2}$/.test(buildingCode) || !roomNo || !/^20\d{2}-\d{2}-\d{2}$/.test(paymentDate) || !Number.isFinite(amountXof) || amountXof <= 0 || !PAYMENT_METHODS.has(paymentMethod)) {
      return NextResponse.json({ error: "楼栋、房号、付款日期、金额和付款方式均为必填。" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: ownedJob, error: jobError } = await supabase.from("ai_jobs").select("id, status").eq("id", jobId).single();
    if (jobError || !ownedJob || ownedJob.status !== "input_received") return NextResponse.json({ error: "AI 输入任务不存在或已处理。" }, { status: 409 });

    const { data: building, error: buildingError } = await supabase.from("buildings").select("id, code, display_name").eq("code", buildingCode).eq("is_active", true).single();
    if (buildingError || !building) return NextResponse.json({ error: "未找到指定楼栋。" }, { status: 404 });
    const { data: unit, error: unitError } = await supabase.from("units").select("id, unit_no, updated_at").eq("building_id", building.id).eq("unit_no", roomNo).single();
    if (unitError || !unit) return NextResponse.json({ error: "未找到指定房间。" }, { status: 404 });
    const { data: contract, error: contractError } = await supabase
      .from("lease_contracts")
      .select("id, customer_id, contract_no, monthly_rent_xof, paid_through_date, updated_at")
      .eq("unit_id", unit.id)
      .eq("status", "active")
      .single();
    if (contractError || !contract) return NextResponse.json({ error: "该房间没有唯一的生效长租合同，不能自动入账。" }, { status: 409 });

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
    const hint = body.business_hint === "rent" || body.business_hint === "property_fee" ? body.business_hint : null;
    const plan = planLeaseFinancialAllocation({
      totalAmountXof: amountXof,
      // Accuracy first: a managed receivable is authoritative. The contract
      // rent is context, not proof that this receipt belongs to that period.
      rentOutstandingXof: outstanding("lease_rent"),
      propertyOutstandingXof: outstanding("property_fee"),
      hint,
    });
    if (plan.kind === "needs_review") return NextResponse.json({ success: false, needsReview: true, plan }, { status: 409 });
    if ((plan.kind === "rent" || plan.kind === "combined") && !paidThroughDate) {
      return NextResponse.json({ success: false, needsReview: true, error: "租金收款必须确认已缴至日期。", plan }, { status: 409 });
    }

    const action = plan.kind === "rent" ? "record_lease_rent" : plan.kind === "property_fee" ? "record_property_fee" : "record_combined_lease_payment";
    const businessRequestId = randomUUID();
    const rentRequestId = randomUUID();
    const propertyRequestId = randomUUID();
    const notes = String(body.notes ?? "").trim().slice(0, 1000) || null;
    const proposal = await createAiProposal(jobId, 1, {
      action,
      target: { buildingId: building.id, unitId: unit.id, leaseContractId: contract.id, customerId: contract.customer_id },
      input: {
        paymentDate,
        paidThroughDate,
        paymentMethod,
        payerName: String(body.payer_name ?? "").trim() || null,
        notes,
        totalAmountXof: amountXof,
        rentAmountXof: plan.rentAmountXof,
        propertyAmountXof: plan.propertyAmountXof,
        businessRequestId,
        rentRequestId,
        propertyRequestId,
      },
      beforeSnapshot: {
        buildingCode,
        roomNo,
        contractNo: contract.contract_no,
        paidThroughDate: contract.paid_through_date,
        rentOutstandingXof: outstanding("lease_rent"),
        propertyOutstandingXof: outstanding("property_fee"),
      },
      beforeVersions: {},
      expectedEffects: [
        { entityType: "payment", operation: "insert", summary: `登记 ${amountXof} XOF 收款` },
        { entityType: "ledger_entry", operation: "insert", summary: "写入对应财务流水" },
        { entityType: "receivable", operation: "update", summary: "按现有应收匹配并更新余额" },
      ],
      warnings: plan.warnings,
      confidence: plan.confidence,
    });

    return NextResponse.json({
      success: true,
      proposal: { id: proposal.id, version: proposal.version, action, expiresAt: proposal.expires_at },
      match: { building: building.display_name || building.code, roomNo, contractNo: contract.contract_no, currentPaidThrough: contract.paid_through_date },
      plan,
    });
  } catch (error) {
    console.error("AI receipt preparation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Receipt preparation failed" }, { status: 500 });
  }
}
