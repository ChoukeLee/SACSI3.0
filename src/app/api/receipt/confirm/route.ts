import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordCombinedLeasePayment, recordLeaseFinancialEntry } from "@/features/leases/actions";
import {
  claimAiProposalExecution,
  completeAiProposalExecution,
  confirmAiProposal,
  loadAiProposalExecutionContext,
} from "@/features/business-actions/ai-draft-service";

const ALLOWED_ACTIONS = new Set(["record_lease_rent", "record_property_fee", "record_combined_lease_payment"]);
type PaymentMethod = "cash" | "check" | "bank_transfer" | "offset" | "other";
const stringValue = (data: Record<string, unknown>, key: string) => typeof data[key] === "string" ? data[key] as string : "";
const numberValue = (data: Record<string, unknown>, key: string) => Number(data[key]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!hasPermission(user, "finance:write")) return NextResponse.json({ error: "Finance write permission required" }, { status: 403 });

  let proposalId = "";
  let executionRequestId = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    proposalId = String(body.proposal_id ?? "");
    const version = Number(body.proposal_version);
    if (!proposalId || !Number.isInteger(version)) return NextResponse.json({ error: "Invalid proposal identity" }, { status: 400 });

    const proposal = await loadAiProposalExecutionContext(proposalId);
    if (!ALLOWED_ACTIONS.has(proposal.action_name) || proposal.status !== "proposed" || proposal.version !== version) {
      return NextResponse.json({ error: "Proposal is no longer confirmable" }, { status: 409 });
    }
    const target = proposal.target as Record<string, unknown>;
    const input = proposal.action_input as Record<string, unknown>;
    const contractId = stringValue(target, "leaseContractId");
    const paymentDate = stringValue(input, "paymentDate");
    const paidThroughDate = stringValue(input, "paidThroughDate");
    const paymentMethod = stringValue(input, "paymentMethod") as PaymentMethod;
    if (!contractId || !paymentDate || !paymentMethod) return NextResponse.json({ error: "Proposal payload is incomplete" }, { status: 409 });
    const preservedNotes = [
      stringValue(input, "notes"),
      stringValue(input, "payerName") ? `付款人：${stringValue(input, "payerName")}` : "",
    ].filter(Boolean).join("；") || undefined;

    const confirmed = await confirmAiProposal(proposalId, version);
    if (!Number.isInteger(confirmed.version)) throw new Error("Confirmation version missing");
    const claimed = await claimAiProposalExecution(proposalId, confirmed.version!);
    executionRequestId = claimed.requestId;

    const requestIds = proposal.action_name === "record_combined_lease_payment"
      ? [stringValue(input, "rentRequestId"), stringValue(input, "propertyRequestId")]
      : [stringValue(input, "businessRequestId")];
    if (requestIds.some((requestId) => !UUID_PATTERN.test(requestId)) || new Set(requestIds).size !== requestIds.length) {
      return NextResponse.json({ error: "Proposal idempotency keys are invalid" }, { status: 409 });
    }

    let result: { success: boolean; error?: string; warning?: string; referenceNo?: string; referenceNos?: string[] };
    if (proposal.action_name === "record_combined_lease_payment") {
      result = await recordCombinedLeasePayment({
        contractId,
        paymentDate,
        paidThroughDate,
        paymentMethod,
        rentAmountXof: numberValue(input, "rentAmountXof"),
        propertyAmountXof: numberValue(input, "propertyAmountXof"),
        notes: preservedNotes,
        rentRequestId: stringValue(input, "rentRequestId"),
        propertyRequestId: stringValue(input, "propertyRequestId"),
      });
    } else {
      result = await recordLeaseFinancialEntry({
        contractId,
        paymentDate,
        paidThroughDate: proposal.action_name === "record_lease_rent" ? paidThroughDate : undefined,
        paymentMethod,
        amountXof: proposal.action_name === "record_lease_rent" ? numberValue(input, "rentAmountXof") : numberValue(input, "propertyAmountXof"),
        businessType: proposal.action_name === "record_lease_rent" ? "rent_income" : "property_fee_income",
        notes: preservedNotes,
        requestId: stringValue(input, "businessRequestId"),
      });
    }
    if (!result.success) {
      await completeAiProposalExecution({ proposalId, requestId: executionRequestId, success: false, verified: false, error: result.error || "financial_write_failed" });
      return NextResponse.json({ error: result.error || "Financial write failed" }, { status: 409 });
    }

    const supabase = await createClient();
    const { data: payments, error: verifyError } = await supabase
      .from("payments")
      .select("id, request_id, amount, payment_method, source_id")
      .in("request_id", requestIds);
    const expectedTotal = numberValue(input, "totalAmountXof");
    const actualTotal = (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
    const verified = !verifyError
      && payments?.length === requestIds.length
      && payments.every((payment) => payment.source_id === contractId && payment.payment_method === paymentMethod)
      && actualTotal === expectedTotal;
    await completeAiProposalExecution({
      proposalId,
      requestId: executionRequestId,
      success: verified,
      verified,
      result: { paymentIds: (payments ?? []).map((payment) => payment.id), totalAmountXof: actualTotal, referenceNos: result.referenceNos ?? (result.referenceNo ? [result.referenceNo] : []) },
      error: verified ? undefined : "post_execution_verification_failed",
    });
    if (!verified) return NextResponse.json({ error: "收款写入后复查未通过，请勿重复提交并联系管理员。" }, { status: 500 });

    for (const path of ["/", "/fr", "/leases", "/fr/leases", "/finance", "/fr/finance", "/management", "/fr/management"]) revalidatePath(path);
    return NextResponse.json({
      success: true,
      paymentIds: payments!.map((payment) => payment.id),
      referenceNos: result.referenceNos ?? (result.referenceNo ? [result.referenceNo] : []),
      warning: result.warning ?? null,
    });
  } catch (error) {
    if (proposalId && executionRequestId) {
      await completeAiProposalExecution({
        proposalId,
        requestId: executionRequestId,
        success: false,
        verified: false,
        error: error instanceof Error ? error.message.slice(0, 500) : "financial_execution_failed",
      }).catch(() => undefined);
    }
    console.error("AI receipt confirmation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Receipt confirmation failed" }, { status: 500 });
  }
}
