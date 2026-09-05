import "server-only";

import type { OcrStructured } from "@/lib/receipt-ocr";

export interface FinancialReceiptDraft {
  building_code: string | null;
  room_no: string | null;
  receipt_no: string | null;
  receipt_date: string | null;
  amount_xof: number | null;
  period_end: string | null;
  business_hint: "rent" | "property_fee" | null;
  payer_name: string | null;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

const isoDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const cleanText = (value: unknown, max = 120) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

function normalizeBuilding(value: unknown) {
  const text = cleanText(value, 20)?.toUpperCase().replace(/\s+/g, "") ?? null;
  if (!text) return null;
  const match = text.match(/(?:SACSI)?(\d{1,2})#?/);
  return match ? `SACSI${Number(match[1])}` : null;
}

function normalizeHint(value: unknown): FinancialReceiptDraft["business_hint"] {
  const text = String(value ?? "").toLowerCase();
  if (/property|物业|charges?/.test(text)) return "property_fee";
  if (/rent|lease_rent|租金|loyer/.test(text)) return "rent";
  return null;
}

function normalizePayload(payload: Record<string, unknown>, warnings: string[] = []): FinancialReceiptDraft {
  const amount = Number(payload.amount_xof);
  const room = cleanText(payload.room_no, 20)?.toUpperCase() ?? null;
  const draft: FinancialReceiptDraft = {
    building_code: normalizeBuilding(payload.building_code),
    room_no: room && /^[A-Z0-9-]{1,20}$/.test(room) ? room : null,
    receipt_no: cleanText(payload.receipt_no, 80),
    receipt_date: isoDate(payload.receipt_date),
    amount_xof: Number.isFinite(amount) && amount > 0 ? amount : null,
    period_end: isoDate(payload.period_end),
    business_hint: normalizeHint(payload.business_hint ?? payload.business_type),
    payer_name: cleanText(payload.payer_name, 120),
    confidence: "high",
    warnings: [...warnings],
  };
  if (!draft.building_code) draft.warnings.push("未识别楼栋，必须人工选择后才能匹配合同。");
  if (!draft.room_no) draft.warnings.push("未识别房号。");
  if (!draft.receipt_date) draft.warnings.push("未识别付款日期。");
  if (!draft.amount_xof) draft.warnings.push("未识别有效金额。");
  if (!draft.period_end && draft.business_hint !== "property_fee") draft.warnings.push("未识别租金已缴至日期。");
  const missing = [draft.building_code, draft.room_no, draft.receipt_date, draft.amount_xof].filter((value) => !value).length;
  draft.confidence = missing > 0 ? "low" : draft.warnings.length ? "medium" : "high";
  return draft;
}

function ruleParse(text: string): FinancialReceiptDraft {
  const building = text.match(/(?:SACSI\s*)?(\d{1,2})\s*(?:#|号楼|栋)/i)?.[1];
  const room = text.match(/(?:房号|房间|公寓|chambre|appartement)\s*[：:]?\s*([A-Za-z0-9-]{2,12})/i)?.[1]
    ?? text.match(/\b(\d{3,4})\b/)?.[1];
  const amountText = text.match(/(?:金额|montant|支付|付款)\s*[：:]?\s*([\d\s,.]+)\s*(?:XOF|FCFA)?/i)?.[1]
    ?? text.match(/([\d][\d\s,.]{3,})\s*(?:XOF|FCFA)/i)?.[1];
  const amount = amountText ? Number(amountText.replace(/[\s,.]/g, "")) : null;
  const dates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
  return normalizePayload({
    building_code: building ? `SACSI${building}` : null,
    room_no: room ?? null,
    receipt_date: dates[0] ?? null,
    period_end: dates[1] ?? null,
    amount_xof: amount,
    business_hint: /物业|charges?/i.test(text) ? "property_fee" : /租金|loyer|rent/i.test(text) ? "rent" : null,
  }, ["使用本地规则提取，请逐项核对。"]);
}

async function parseWithDeepSeek(text: string): Promise<Record<string, unknown> | null> {
  if (process.env.AI_QUERY_PROVIDER !== "deepseek" || !process.env.DEEPSEEK_API_KEY) return null;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      max_tokens: 400,
      messages: [
        { role: "system", content: "Extract a property payment receipt. Output JSON only with building_code (SACSI11), room_no, receipt_no, receipt_date (YYYY-MM-DD), amount_xof (number), period_end (YYYY-MM-DD), business_hint (rent|property_fee|null), payer_name. Never invent missing values." },
        { role: "user", content: text.slice(0, 10_000) },
      ],
    }),
  });
  if (!response.ok) return null;
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;
  try { return JSON.parse(content) as Record<string, unknown>; } catch { return null; }
}

export async function parseFinancialReceiptDraft(text: string, structured?: OcrStructured | null) {
  if (structured && (structured.amount_xof || structured.room_no || structured.receipt_date)) {
    return normalizePayload(structured as Record<string, unknown>, structured.warnings ?? []);
  }
  const model = await parseWithDeepSeek(text).catch(() => null);
  return model ? normalizePayload(model) : ruleParse(text);
}
