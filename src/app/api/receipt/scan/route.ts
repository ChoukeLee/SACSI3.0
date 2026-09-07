import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { extractReceiptTextFromImage } from "@/lib/receipt-ocr";
import {
  addAiTextInput,
  completeAiInputExtraction,
  createAiJob,
  reserveAiFileInput,
} from "@/features/business-actions/ai-draft-service";
import { parseFinancialReceiptDraft } from "@/features/ai-workbench/receipt-draft-parser";
import { appendConversationTurn } from "@/features/ai-workbench/conversation-service";

const ALLOWED_IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!hasPermission(user, "finance:write")) return NextResponse.json({ error: "Finance write permission required" }, { status: 403 });

  try {
    const form = await request.formData();
    const fileValue = form.get("file");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
    const manualText = String(form.get("manual_text") ?? "").trim();
    const locale = String(form.get("locale") ?? "") === "fr" ? "fr" : "zh";
    const conversationId = String(form.get("conversation_id") ?? "").trim();
    if (!file && !manualText) return NextResponse.json({ error: "No image or text provided" }, { status: 400 });
    if (file && (!ALLOWED_IMAGES.has(file.type) || file.size > 10 * 1024 * 1024)) {
      return NextResponse.json({ error: "Only JPEG, PNG or WebP images up to 10 MB are accepted" }, { status: 415 });
    }

    const job = await createAiJob({ inputMode: file ? "image" : "text", locale, conversationId });
    let inputId: string;
    let rawText = manualText;
    let provider = "manual";
    let storagePath: string | null = null;
    let ocrError: string | null = null;
    let structured = null;

    if (file) {
      const reserved = await reserveAiFileInput({
        jobId: String(job.id),
        sequenceNo: 1,
        inputType: "image",
        filename: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
      });
      inputId = reserved.inputId;
      storagePath = reserved.storagePath;
      const bytes = Buffer.from(await file.arrayBuffer());
      const supabase = await createClient();
      const { error: uploadError } = await supabase.storage
        .from("ai-inputs")
        .uploadToSignedUrl(storagePath, reserved.token, bytes, { contentType: file.type });
      if (uploadError) throw new Error(`Receipt upload failed: ${uploadError.message}`);

      const ocr = await extractReceiptTextFromImage(bytes, file.name);
      if (manualText) await addAiTextInput(String(job.id), 2, manualText);
      rawText = [ocr.rawText, manualText].filter(Boolean).join("\n\n");
      provider = ocr.provider;
      ocrError = ocr.error ?? null;
      structured = ocr.structured ?? null;
      const draft = await parseFinancialReceiptDraft(rawText, structured);
      await completeAiInputExtraction({
        inputId,
        extractedText: rawText,
        extractionResult: { provider, draft, ocrError },
        containsSensitiveData: true,
      });
      await appendConversationTurn({
        conversationId,
        kind: "receipt",
        userText: manualText || `[${file.name}]`,
        assistantText: locale === "fr" ? "Justificatif extrait ; vérifiez les champs avant de préparer le brouillon." : "凭证已完成候选提取，请核对字段后生成草稿。",
        jobId: String(job.id),
        context: { buildingCode: draft.building_code, unitNo: draft.room_no, domain: "lease", inputId },
      });
      return NextResponse.json({ success: true, jobId: job.id, inputId, storagePath, ocrText: rawText, ocrProvider: provider, ocrError, draft, status: "extracted" });
    }

    const input = await addAiTextInput(String(job.id), 1, manualText);
    inputId = String(input.id);
    const draft = await parseFinancialReceiptDraft(manualText);
    await appendConversationTurn({
      conversationId,
      kind: "receipt",
      userText: manualText,
      assistantText: locale === "fr" ? "Texte extrait ; vérifiez les champs avant de préparer le brouillon." : "文字凭证已完成候选提取，请核对字段后生成草稿。",
      jobId: String(job.id),
      context: { buildingCode: draft.building_code, unitNo: draft.room_no, domain: "lease", inputId },
    });
    return NextResponse.json({ success: true, jobId: job.id, inputId, storagePath: null, ocrText: manualText, ocrProvider: provider, ocrError, draft, status: "extracted" });
  } catch (error) {
    console.error("AI receipt scan failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Receipt scan failed" }, { status: 500 });
  }
}
