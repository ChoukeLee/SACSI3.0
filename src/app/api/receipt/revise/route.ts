import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadAiProposalExecutionContext, reviseAiProposalV2 } from "@/features/business-actions/ai-draft-service";
import { appendConversationTurn } from "@/features/ai-workbench/conversation-service";
import { buildLeaseReceiptProposal, type ReceiptPaymentMethod, type ReceiptProposalFields } from "@/features/ai-workbench/receipt-proposal-service";
import { parseReceiptRevisionInstruction, type ReceiptRevisionPatch } from "@/features/ai-workbench/receipt-revision-parser";
import { interpretReceiptRevisionWithModel } from "@/features/ai-workbench/receipt-revision-model";

const ALLOWED_ACTIONS = new Set(["record_lease_rent", "record_property_fee", "record_combined_lease_payment"]);
const value = (record: Record<string, unknown>, key: string) => record[key];
const text = (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? String(record[key]) : "";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!hasPermission(user, "finance:write")) return NextResponse.json({ error: "Finance write permission required" }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const proposalId = String(body.proposal_id ?? "");
    const expectedVersion = Number(body.proposal_version);
    const conversationId = String(body.conversation_id ?? "");
    const instruction = String(body.instruction ?? "").trim();
    if (!proposalId || !conversationId || !Number.isInteger(expectedVersion)) {
      return NextResponse.json({ error: "Invalid proposal or conversation identity" }, { status: 400 });
    }

    const proposal = await loadAiProposalExecutionContext(proposalId);
    if (!ALLOWED_ACTIONS.has(proposal.action_name) || !["awaiting_clarification", "proposed"].includes(proposal.status) || proposal.version !== expectedVersion) {
      return NextResponse.json({ error: "草稿已变化或不再允许修改，请刷新后重试。" }, { status: 409 });
    }
    const supabase = await createClient();
    const { data: job, error: jobError } = await supabase.from("ai_jobs").select("id, conversation_id, locale").eq("id", proposal.job_id).single();
    if (jobError || !job || job.conversation_id !== conversationId) {
      return NextResponse.json({ error: "草稿与当前会话不匹配。" }, { status: 409 });
    }

    const input = proposal.action_input as Record<string, unknown>;
    const snapshot = proposal.before_snapshot as Record<string, unknown>;
    const current: ReceiptProposalFields = {
      buildingCode: text(snapshot, "buildingCode"),
      roomNo: text(snapshot, "roomNo"),
      amountXof: Number(value(input, "totalAmountXof")),
      receiptDate: text(input, "paymentDate"),
      paidThroughDate: text(input, "paidThroughDate") || null,
      payerName: text(input, "payerName") || null,
      notes: text(input, "notes") || null,
      paymentMethod: text(input, "paymentMethod") as ReceiptPaymentMethod,
      businessHint: proposal.action_name === "record_property_fee" ? "property_fee" : proposal.action_name === "record_lease_rent" ? "rent" : null,
    };
    let interpretationSource: "rules" | "deepseek" | "openai" = "rules";
    let interpretationConfidence = 1;
    let patch: ReceiptRevisionPatch;
    try {
      patch = parseReceiptRevisionInstruction(instruction);
    } catch (ruleError) {
      const interpreted = await interpretReceiptRevisionWithModel({ instruction, userId: user.id });
      if (!interpreted || interpreted.confidence < 0.75) {
        throw ruleError instanceof Error ? ruleError : new Error("无法可靠理解这条修改指令。");
      }
      patch = interpreted.patch;
      interpretationSource = interpreted.provider;
      interpretationConfidence = interpreted.confidence;
    }
    const changedFields = Object.keys(patch).filter((key) => current[key as keyof ReceiptProposalFields] !== patch[key as keyof typeof patch]);
    if (changedFields.length === 0) return NextResponse.json({ error: "修改内容与当前草稿相同。" }, { status: 409 });

    const built = await buildLeaseReceiptProposal({ ...current, ...patch });
    const revised = await reviseAiProposalV2(proposalId, expectedVersion, built.draft, changedFields);
    const version = Number(revised.version);
    const modelUnderstood = interpretationSource !== "rules";
    const assistantText = job.locale === "fr"
      ? `${modelUnderstood ? "Instruction structurée par le modèle ; " : ""}brouillon mis à jour en v${version} : ${built.match.building} ${built.match.roomNo}, ${built.fields.amountXof} XOF. Une confirmation humaine reste obligatoire.`
      : `${modelUnderstood ? "已通过结构化模型理解指令；" : ""}草稿已更新至 v${version}：${built.match.building} ${built.match.roomNo}，${built.fields.amountXof} XOF，仍需人工确认后才会入账。`;
    await appendConversationTurn({
      conversationId,
      kind: "action_draft",
      userText: instruction,
      assistantText,
      jobId: String(proposal.job_id),
      context: { buildingCode: built.fields.buildingCode, unitNo: built.fields.roomNo, domain: "lease", proposalId, proposalVersion: version, changedFields, interpretationSource, interpretationConfidence },
    });

    return NextResponse.json({
      success: true,
      message: assistantText,
      changedFields,
      interpretation: { source: interpretationSource, confidence: interpretationConfidence },
      proposal: { id: proposalId, version, action: built.draft.action, expiresAt: revised.expires_at },
      match: built.match,
      plan: built.plan,
      fields: built.fields,
    });
  } catch (error) {
    console.error("AI receipt revision failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Receipt revision failed" }, { status: 500 });
  }
}
