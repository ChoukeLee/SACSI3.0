/**
 * Receipt OCR abstraction layer.
 *
 * Supported providers: mock (default), openai-vision, qwen-vl-plus.
 * Set OCR_PROVIDER and corresponding API key env var to enable.
 */

export interface OcrStructured {
  receipt_no?: string | null;
  receipt_date?: string | null;
  room_no?: string | null;
  amount_xof?: number | null;
  currency?: string;
  period_start?: string | null;
  period_end?: string | null;
  business_type?: string | null;
  payer_name?: string | null;
  warnings?: string[];
}

export interface OcrResult {
  rawText: string;
  provider: string;
  processedAt: string;
  error?: string | null;
  /** Structured fields when the OCR provider returns JSON (Qwen, GPT-4o, etc.) */
  structured?: OcrStructured | null;
}

export async function extractReceiptTextFromImage(
  fileBuffer: Buffer,
  fileName: string,
): Promise<OcrResult> {
  const provider = process.env.OCR_PROVIDER ?? "mock";
  const processedAt = new Date().toISOString();

  try {
    if (provider === "openai-vision") {
      const result = await extractWithOpenAiVision(fileBuffer, fileName);
      return { ...result, provider, processedAt };
    }
    if (provider === "qwen-vl-plus") {
      const result = await extractWithQwenVision(fileBuffer, fileName);
      return { ...result, provider, processedAt };
    }
    return {
      rawText: ["=== RECEIPT (MOCK)", `File: ${fileName}`, `Size: ${fileBuffer.length} bytes`, "", "Set OCR_PROVIDER=qwen-vl-plus and QWEN_API_KEY to enable real OCR."].join("\n"),
      provider, processedAt, error: null,
    };
  } catch (err) {
    return { rawText: "", provider, processedAt, error: err instanceof Error ? err.message : "OCR extraction failed" };
  }
}

// ── Qwen VL Plus ─────────────────────────────────────────────

const QWEN_VISION_PROMPT = [
  "你是 SACIS 房产系统的收款收据 OCR 引擎。从图片中逐字识别收据内容，只输出严格 JSON。",
  "{",
  '  "raw_text": "识别到的完整文字",',
  '  "receipt_no": "收据编号或null",',
  '  "receipt_date": "YYYY-MM-DD 收据抬头/右上角的收款或开票日期",',
  '  "room_no": "纯数字房号如103、602或null",',
  '  "amount_text": "金额原文如195万或null",',
  '  "amount_xof": 1950000,',
  '  "currency": "XOF",',
  '  "period_start": "YYYY-MM-DD 正文中交款/租期的开始日期",',
  '  "period_end": "YYYY-MM-DD 正文中交款/租期的结束日期",',
  '  "business_type": "lease_rent|daily_rental|managed_lease_rent|sale|other|null",',
  '  "payer_name": "付款人或null",',
  '  "warnings": []',
  "}",
  "规则: receipt_date≠period_start可不同; 万=×10000, 195万=1950000; 日期均YYYY-MM-DD; 不确定填null+warnings。",
].join("\n");

async function extractWithQwenVision(
  fileBuffer: Buffer,
  fileName: string,
): Promise<{ rawText: string; structured?: OcrStructured | null }> {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) return { rawText: "QWEN_API_KEY not set." };

  const baseUrl = (process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
  const model = process.env.QWEN_VISION_MODEL ?? "qwen-vl-plus";
  const mime = detectMime(fileName);
  const dataUrl = `data:${mime};base64,${fileBuffer.toString("base64")}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, temperature: 0,
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUrl } }, { type: "text", text: QWEN_VISION_PROMPT }] }],
    }),
  });

  if (!res.ok) { const errText = await res.text(); return { rawText: `Qwen error: ${res.status} — ${errText.slice(0, 200)}` }; }

  const data = await res.json();
  const rawText = data?.choices?.[0]?.message?.content ?? "";
  const structured = parseStructuredJson(rawText);
  return { rawText, structured };
}

// ── OpenAI Vision ────────────────────────────────────────────

async function extractWithOpenAiVision(
  fileBuffer: Buffer,
  fileName: string,
): Promise<{ rawText: string; structured?: OcrStructured | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { rawText: "OPENAI_API_KEY not set." };

  const mime = detectMime(fileName);
  const dataUrl = `data:${mime};base64,${fileBuffer.toString("base64")}`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUrl, detail: "high" } }, { type: "text", text: "Extract ALL text visible. Include receipt number, date, amounts, payer, period, room number. Preserve line breaks." }] }],
      max_tokens: 1000,
    }),
  });
  if (!res.ok) { const errText = await res.text(); return { rawText: `OpenAI error: ${res.status} — ${errText.slice(0, 200)}` }; }
  const data = await res.json();
  return { rawText: data?.choices?.[0]?.message?.content ?? "" };
}

// ── JSON extraction helper ───────────────────────────────────

function parseStructuredJson(text: string): OcrStructured | null {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fenced?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      receipt_no: parsed.receipt_no as string | null ?? null,
      receipt_date: normalizeDateStr(parsed.receipt_date as string),
      room_no: parsed.room_no as string | null ?? null,
      amount_xof: typeof parsed.amount_xof === "number" ? parsed.amount_xof : null,
      currency: (parsed.currency as string) ?? "XOF",
      period_start: normalizeDateStr(parsed.period_start as string),
      period_end: normalizeDateStr(parsed.period_end as string),
      business_type: parsed.business_type as string | null ?? null,
      payer_name: parsed.payer_name as string | null ?? null,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings as string[] : undefined,
    };
  } catch { return null; }
}

function normalizeDateStr(s: string | null | undefined): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [d, m, y] = s.split("/"); return `${y}-${m}-${d}`; }
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(s)) { const [d, m, y] = s.split("/"); return `20${y}-${m}-${d}`; }
  return null;
}

function detectMime(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}
