import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { extractReceiptTextFromImage } from "@/lib/receipt-ocr";

interface ReceiptDraft {
  room_no: string | null;
  receipt_no: string | null;
  receipt_date: string | null;
  amount_xof: number | null;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  business_type: string | null;
  payer_name: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

const today = () => new Date().toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════
// Normalize draft — fix Chinese amounts, validate fields
// ═══════════════════════════════════════════════════

function normalizeReceiptDraft(draft: ReceiptDraft, ocrText: string): ReceiptDraft {
  const warnings = [...draft.warnings];
  let amount = draft.amount_xof;
  const amountText = draft.notes ?? ocrText;

  // Fix Chinese 万 amounts: if OCR text says "195万" but amount is 195000, correct to 1,950,000
  const wanMatch = amountText.match(/(\d+)\s*万/);
  if (wanMatch) {
    const expectedWan = parseInt(wanMatch[1], 10) * 10000;
    if (amount && amount < 1000000 && amount < expectedWan * 0.1) {
      warnings.push(`金额疑似错误：原文"${wanMatch[0]}"应为${expectedWan.toLocaleString()}，但识别为${amount.toLocaleString()}，已自动修正。`);
      amount = expectedWan;
    }
    // If no amount was extracted but 万 is present, use the wan value
    if (!amount) {
      amount = expectedWan;
      warnings.push(`从原文"${wanMatch[0]}"推导金额=${expectedWan.toLocaleString()}。`);
    }
  }

  // receipt_date must not be copied to period_start
  if (draft.period_start === draft.receipt_date && ocrText.includes("周期") || ocrText.includes("租期") || ocrText.includes("期间")) {
    warnings.push("period_start与receipt_date相同，请确认原文中是否有独立租期。");
  }

  // period start > end
  if (draft.period_start && draft.period_end && draft.period_start > draft.period_end) {
    warnings.push(`周期开始(${draft.period_start})晚于结束(${draft.period_end})。`);
  }

  // Low amount for lease
  if (draft.business_type === "lease_rent" && amount && amount < 300000 && /万/.test(amountText)) {
    warnings.push(`长租金额${amount?.toLocaleString()}偏低，原文含"万"，请确认。`);
  }

  let confidence: "high" | "medium" | "low" = "high";
  if (!draft.room_no) { confidence = "low"; warnings.push("未识别到房号。"); }
  if (!amount || amount <= 0) { confidence = "low"; warnings.push("未识别到金额或金额无效。"); }
  else if (!draft.receipt_date) { confidence = "medium"; warnings.push("未识别到日期。"); }
  else if (!draft.receipt_no) { confidence = "medium"; warnings.push("未识别到收据号。"); }

  return { ...draft, amount_xof: amount, confidence, warnings };
}

// ═══════════════════════════════════════════════════
// Draft parser
// ═══════════════════════════════════════════════════

async function parseReceiptDraft(ocrText: string, locale: string, structured?: import("@/lib/receipt-ocr").OcrStructured | null): Promise<ReceiptDraft> {
  // If Qwen/OpenAI vision returned structured JSON, use it directly
  if (structured && (structured.amount_xof || structured.room_no || structured.receipt_date)) {
    const draft: ReceiptDraft = {
      room_no: structured.room_no ?? null,
      receipt_no: structured.receipt_no ?? null,
      receipt_date: structured.receipt_date ?? null,
      amount_xof: structured.amount_xof ?? null,
      currency: structured.currency ?? "XOF",
      period_start: structured.period_start ?? null,
      period_end: structured.period_end ?? null,
      business_type: structured.business_type ?? null,
      payer_name: structured.payer_name ?? null,
      notes: null,
      confidence: "high",
      warnings: structured.warnings ?? [],
    };
    return normalizeReceiptDraft(draft, ocrText);
  }

  const warnings: string[] = [];
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (apiKey) {
    try {
      const draft = await parseWithDeepSeek(ocrText, locale);
      return normalizeReceiptDraft({ ...draft, warnings: [...draft.warnings, ...warnings] }, ocrText);
    } catch { /* fall through */ }
  }

  return normalizeReceiptDraft(fallbackParseDraft(ocrText), ocrText);
}

async function parseWithDeepSeek(ocrText: string, locale: string): Promise<ReceiptDraft> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

  const system = [
    "You parse French real-estate receipt OCR text into structured JSON.",
    "The property is in Abidjan, Côte d'Ivoire. Currency is XOF / FCFA.",
    "Business types: daily_rental (日租), lease_rent (长租), managed_lease_rent (代租), sale (出售), other.",
    "Return ONLY JSON (no markdown):",
    "{",
    '  "room_no": "602" or null,',
    '  "receipt_no": "RECU-00123" or null,',
    '  "receipt_date": "2026-06-01" or null,',
    '  "amount_xof": 1950000 or null,',
    '  "currency": "XOF",',
    '  "period_start": "2026-05-01" or null,',
    '  "period_end": "2026-05-31" or null,',
    '  "business_type": "lease_rent" or null,',
    '  "payer_name": "KOUAME Jean" or null,',
    '  "notes": "additional notes" or null',
    "}",
  ].join("\n");

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `OCR text:\n${ocrText}\n\nLocale: ${locale}\nToday: ${today()}` },
      ],
    }),
  });

  if (!res.ok) throw new Error("DeepSeek call failed");
  const data = await res.json();
  const json = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
  return {
    room_no: json.room_no ?? null,
    receipt_no: json.receipt_no ?? null,
    receipt_date: json.receipt_date ?? null,
    amount_xof: typeof json.amount_xof === "number" ? json.amount_xof : null,
    currency: json.currency ?? "XOF",
    period_start: json.period_start ?? null,
    period_end: json.period_end ?? null,
    business_type: json.business_type ?? null,
    payer_name: json.payer_name ?? null,
    notes: json.notes ?? null,
    confidence: "medium",
    warnings: [],
  };
}

function fallbackParseDraft(ocrText: string): ReceiptDraft {
  const warnings: string[] = [];
  const roomMatch = ocrText.match(/\b(\d{3,4})\b/);
  const amountMatch = ocrText.match(/(\d[\d\s]*\d{3})\s*(XOF|FCFA|fcfa|xof)?/i) ??
    ocrText.match(/montant[:\s]*(\d[\d\s]*\d{3})/i);
  const dateMatch = ocrText.match(/(\d{4}-\d{2}-\d{2})/) ?? ocrText.match(/(\d{2}\/\d{2}\/\d{4})/);
  const receiptMatch = ocrText.match(/re[cç]u\s*(n[°o]?|no)?[:\s]*(\S+)/i) ??
    ocrText.match(/(RECU|QUITTANCE)[-:\s]*(\S+)/i);
  const periodMatch = ocrText.match(/(?:p[eé]riode|du)[:\s]*(\d{2}\/\d{2}\/\d{4})\s*(?:au|à|–|-)\s*(\d{2}\/\d{2}\/\d{4})/i);
  const isLease = /loyer|location|bail|mois|mensuel/i.test(ocrText);

  return {
    room_no: roomMatch?.[1] ?? null,
    receipt_no: receiptMatch?.[2] ?? null,
    receipt_date: dateMatch?.[1] ?? null,
    amount_xof: amountMatch ? parseInt(amountMatch[1].replace(/\s/g, ""), 10) : null,
    currency: "XOF",
    period_start: periodMatch?.[1] ?? null,
    period_end: periodMatch?.[2] ?? null,
    business_type: isLease ? "lease_rent" : null,
    payer_name: null,
    notes: null,
    confidence: "low",
    warnings: ["规则引擎解析，字段可能不完整。请人工核对。"],
  };
}

// ═══════════════════════════════════════════════════
// POST — upload receipt image, OCR, parse draft
// ═══════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const manualText = formData.get("manual_text") as string | null;
    const locale = (formData.get("locale") as string) ?? "zh";

    let ocrText: string;
    let provider: string;
    let ocrError: string | null = null;

    if (file && file.size > 0) {
      // Save uploaded image
      const supabase = await createClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const storagePath = `receipts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      const { error: uploadErr } = await supabase.storage
        .from("receipts")
        .upload(storagePath, fileBuffer, { contentType: file.type, upsert: false });

      if (uploadErr) {
        return NextResponse.json({ error: `Failed to save image: ${uploadErr.message}` }, { status: 500 });
      }

      // Run OCR
      const ocrResult = await extractReceiptTextFromImage(fileBuffer, file.name);
      ocrText = ocrResult.rawText;
      provider = ocrResult.provider;
      ocrError = ocrResult.error ?? null;

      // Parse draft (use structured OCR JSON when available)
      const draft = await parseReceiptDraft(ocrText, locale, ocrResult.structured);

      return NextResponse.json({
        success: true,
        imagePath: storagePath,
        imageUrl: null, // Will be generated on load via signed URL if needed
        ocrText,
        ocrProvider: provider,
        ocrError,
        draft,
        status: "draft",
      });
    }

    if (manualText) {
      ocrText = manualText;
      provider = "manual";
      const draft = await parseReceiptDraft(ocrText, locale);

      return NextResponse.json({
        success: true,
        imagePath: null,
        imageUrl: null,
        ocrText: manualText,
        ocrProvider: "manual",
        ocrError: null,
        draft,
        status: "draft",
      });
    }

    return NextResponse.json({ error: "No file or manual text provided" }, { status: 400 });
  } catch (err) {
    console.error("receipt scan error", err);
    return NextResponse.json({ error: "Receipt scan failed" }, { status: 500 });
  }
}
