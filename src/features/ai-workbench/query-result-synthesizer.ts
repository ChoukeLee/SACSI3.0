import "server-only";

import type { Locale } from "@/lib/i18n";
import type { QueryPlanTool } from "./query-plan";
import type { WorkbenchResult } from "./types";

interface QueryResultSynthesisPacket {
  locale: Locale;
  tool: QueryPlanTool;
  title: string;
  metrics: Array<{ label: string; value: string }>;
  evidence: Array<{ label: string; value: string }>;
  warnings: string[];
  resultCount: number;
}

function clipped(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

/**
 * Deliberately excludes the original question, scope, deterministic answer and
 * every table row. This prevents customer names, contract numbers and raw
 * business records from entering the prose model through this layer.
 */
export function buildQueryResultSynthesisPacket(
  locale: Locale,
  tool: QueryPlanTool,
  result: WorkbenchResult,
): QueryResultSynthesisPacket {
  return {
    locale,
    tool,
    title: clipped(result.title, 180),
    metrics: result.metrics.slice(0, 8).map((metric) => ({
      label: clipped(metric.label, 80),
      value: clipped(metric.value, 100),
    })),
    evidence: result.evidence.slice(0, 8).map((item) => ({
      label: clipped(item.label, 80),
      value: clipped(item.value, 240),
    })),
    warnings: result.warnings.slice(0, 5).map((warning) => clipped(warning, 240)),
    resultCount: result.resultCount,
  };
}

function numericFacts(value: string) {
  return value.match(/\d+(?:[.,]\d+)*/g)?.map((token) => token.replace(/[.,]/g, "")) ?? [];
}

export function validateSynthesizedAnswer(answer: unknown, packet: QueryResultSynthesisPacket) {
  if (typeof answer !== "string") return null;
  const normalized = answer.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 700 || /```|^#{1,6}\s/m.test(normalized)) return null;
  const allowedNumbers = new Set(numericFacts(JSON.stringify(packet)));
  if (numericFacts(normalized).some((token) => !allowedNumbers.has(token))) return null;
  return normalized;
}

export async function synthesizeQueryPlanResult(input: {
  locale: Locale;
  tool: QueryPlanTool;
  result: WorkbenchResult;
}): Promise<WorkbenchResult> {
  if (process.env.AI_QUERY_RESULT_SYNTHESIS_ENABLED !== "true") return input.result;
  const provider = (process.env.AI_QUERY_RESULT_SYNTHESIS_PROVIDER || process.env.AI_QUERY_PROVIDER || "deepseek").toLowerCase();
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (provider !== "deepseek" || !apiKey) return input.result;

  const packet = buildQueryResultSynthesisPacket(input.locale, input.tool, input.result);
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.AI_QUERY_RESULT_SYNTHESIS_MODEL
    || process.env.AI_QUERY_PLANNER_MODEL
    || process.env.DEEPSEEK_MODEL
    || "deepseek-v4-flash";
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: [
              "You write one concise, natural response for a property-management operator.",
              `Write in ${input.locale === "fr" ? "French" : "Simplified Chinese"}.`,
              "Use only facts present in the supplied JSON. Never infer or invent names, dates, amounts, counts, causes or completed actions.",
              "Do not claim that data was modified. Mention a warning when supplied. Return JSON only: {\"answer\":\"...\"}.",
            ].join(" "),
          },
          { role: "user", content: JSON.stringify(packet) },
        ],
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        max_tokens: 350,
        stream: false,
      }),
    });
    if (!response.ok) return input.result;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return input.result;
    const parsed = JSON.parse(content) as { answer?: unknown };
    const answer = validateSynthesizedAnswer(parsed.answer, packet);
    return answer ? { ...input.result, answer } : input.result;
  } catch {
    return input.result;
  }
}
