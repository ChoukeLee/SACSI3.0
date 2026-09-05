import "server-only";

import { createHash } from "node:crypto";
import type { WorkbenchIntent } from "./types";

type ModelProvider = "deepseek" | "openai";

const allowedKinds = new Set<WorkbenchIntent["kind"]>([
  "daily_status",
  "receivable_overdue",
  "receivable_outstanding",
  "receivable_due_soon",
  "unit_snapshot",
  "unsupported",
]);
const allowedDomains = new Set<WorkbenchIntent["domain"]>(["all", "daily", "lease", "sale"]);

const systemPrompt = [
  "You classify Chinese property-management questions into a closed query catalog and output json only.",
  "Never answer the question and never generate SQL.",
  "Allowed kinds: daily_status, receivable_overdue, receivable_outstanding, receivable_due_soon, unit_snapshot, unsupported.",
  "Allowed domains: all, daily, lease, sale.",
  "buildingCode must be SACSI plus the building number, for example SACSI11. Return null when absent.",
  "unitNo is the exact room number or null. days defaults to 15 and must be between 1 and 90.",
  "JSON example: {\"kind\":\"unit_snapshot\",\"domain\":\"all\",\"buildingCode\":\"SACSI11\",\"unitNo\":\"503\",\"days\":15,\"confidence\":0.98}",
].join(" ");

function normalizeIntent(payload: unknown, asOfDate: string, provider: ModelProvider): WorkbenchIntent | null {
  if (!payload || typeof payload !== "object") return null;
  const parsed = payload as Partial<WorkbenchIntent>;
  if (!parsed.kind || !allowedKinds.has(parsed.kind) || !parsed.domain || !allowedDomains.has(parsed.domain)) return null;
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const days = Number(parsed.days ?? 15);
  if (!Number.isInteger(days) || days < 1 || days > 90) return null;

  const buildingCode = typeof parsed.buildingCode === "string" ? parsed.buildingCode.trim().toUpperCase() : null;
  const unitNo = typeof parsed.unitNo === "string" ? parsed.unitNo.trim().toUpperCase() : null;
  if (buildingCode !== null && !/^SACSI\d{1,3}$/.test(buildingCode)) return null;
  if (unitNo !== null && !/^[A-Z0-9-]{1,20}$/.test(unitNo)) return null;

  return {
    kind: parsed.kind,
    domain: parsed.kind === "daily_status" ? "daily" : parsed.domain,
    buildingCode,
    unitNo,
    customerName: null,
    days,
    asOfDate,
    confidence,
    source: provider,
  };
}

function extractOpenAIOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

async function classifyWithDeepSeek(query: string, asOfDate: string): Promise<WorkbenchIntent | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      max_tokens: 300,
      stream: false,
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    return normalizeIntent(JSON.parse(content), asOfDate, "deepseek");
  } catch {
    return null;
  }
}

async function classifyWithOpenAI(query: string, asOfDate: string, userId: string): Promise<WorkbenchIntent | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_QUERY_MODEL;
  if (!apiKey || !model) return null;
  const safetyIdentifier = createHash("sha256").update(userId).digest("hex");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      model,
      store: false,
      safety_identifier: safetyIdentifier,
      instructions: systemPrompt,
      input: query,
      text: {
        format: {
          type: "json_schema",
          name: "sacsi_query_intent",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: [...allowedKinds] },
              domain: { type: "string", enum: [...allowedDomains] },
              buildingCode: { type: ["string", "null"] },
              unitNo: { type: ["string", "null"] },
              days: { type: "integer", minimum: 1, maximum: 90 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["kind", "domain", "buildingCode", "unitNo", "days", "confidence"],
          },
        },
      },
    }),
  });
  if (!response.ok) return null;
  const text = extractOpenAIOutputText(await response.json());
  if (!text) return null;
  try {
    return normalizeIntent(JSON.parse(text), asOfDate, "openai");
  } catch {
    return null;
  }
}

export async function classifyWorkbenchIntentWithModel(input: {
  query: string;
  asOfDate: string;
  userId: string;
}): Promise<WorkbenchIntent | null> {
  if (process.env.AI_QUERY_CLASSIFIER_ENABLED !== "true") return null;
  const provider = (process.env.AI_QUERY_PROVIDER || "deepseek").toLowerCase();
  if (provider === "deepseek") return classifyWithDeepSeek(input.query, input.asOfDate);
  if (provider === "openai") return classifyWithOpenAI(input.query, input.asOfDate, input.userId);
  return null;
}
