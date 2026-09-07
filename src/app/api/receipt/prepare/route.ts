import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAiProposal } from "@/features/business-actions/ai-draft-service";
import { appendConversationTurn } from "@/features/ai-workbench/conversation-service";
import { buildLeaseReceiptProposal, type ReceiptPaymentMethod } from "@/features/ai-workbench/receipt-proposal-service";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!hasPermission(user, "finance:write")) return NextResponse.json({ error: "Finance write permission required" }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const jobId = String(body.job_id ?? "");
    const conversationId = String(body.conversation_id ?? "");
    if (!jobId || !conversationId) return NextResponse.json({ error: "AI job and conversation are required." }, { status: 400 });

    const supabase = await createClient();
    const { data: ownedJob, error: jobError } = await supabase.from("ai_jobs").select("id, status, conversation_id").eq("id", jobId).single();
    if (jobError || !ownedJob || ownedJob.status !== "input_received" || ownedJob.conversation_id !== conversationId) {
      return NextResponse.json({ error: "AI 输入任务不存在、会话不匹配或已处理。" }, { status: 409 });
    }

    const built = await buildLeaseReceiptProposal({
      buildingCode: String(body.building_code ?? ""),
      roomNo: String(body.room_no ?? ""),
      amountXof: Number(body.amount_xof),
      receiptDate: String(body.receipt_date ?? ""),
      paidThroughDate: body.period_end ? String(body.period_end) : null,
      payerName: body.payer_name ? String(body.payer_name) : null,
      paymentMethod: String(body.payment_method ?? "") as ReceiptPaymentMethod,
      businessHint: body.business_hint === "rent" || body.business_hint === "property_fee" ? body.business_hint : null,
      notes: body.notes ? String(body.notes) : null,
    });
    const proposal = await createAiProposal(jobId, 1, built.draft);
    await appendConversationTurn({
      conversationId,
      kind: "action_draft",
      userText: "生成凭证入账草稿",
      assistantText: `草稿 v${proposal.version}：${built.match.building} ${built.match.roomNo}，${built.fields.amountXof} XOF，等待人工确认。`,
      jobId,
      context: { buildingCode: built.fields.buildingCode, unitNo: built.fields.roomNo, domain: "lease", proposalId: String(proposal.id), proposalVersion: Number(proposal.version) },
    });

    return NextResponse.json({
      success: true,
      proposal: { id: proposal.id, version: proposal.version, action: built.draft.action, expiresAt: proposal.expires_at },
      match: built.match,
      plan: built.plan,
      fields: built.fields,
    });
  } catch (error) {
    console.error("AI receipt preparation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Receipt preparation failed" }, { status: 500 });
  }
}
