import "server-only";

import type { Locale } from "@/lib/i18n";
import { normalizeQueryPlanV2, QUERY_PLAN_METRICS, QUERY_PLAN_RECEIVABLE_STATES, QUERY_PLAN_TIME_KINDS, QUERY_PLAN_TOOLS, type QueryPlanV2 } from "./query-plan";

export interface QueryPlannerConversationTurn {
  userText: string;
  context: Record<string, unknown>;
}

const toolDescriptions = {
  get_daily_status: "Current daily-rental room availability and occupancy for a building or all managed buildings.",
  list_daily_movements: "Daily-rental arrivals and departures for a time expression.",
  list_lease_expirations: "Active leases whose paid-through checkpoint falls in a time expression.",
  list_receivables: "Managed receivables filtered by overdue, outstanding, or due-in-window state.",
  get_unit_snapshot: "Current unit, active contract or booking, customer and confirmed financial balance for one unit.",
};

function plannerPrompt(input: { asOfDate: string; locale: Locale }) {
  return [
    "You are the read-only query planner for SACSI, a property-management system.",
    "Understand the user's business objective; do not force it into one intent when multiple safe tools are needed.",
    `Reference date: ${input.asOfDate}. Timezone: Africa/Abidjan. User locale: ${input.locale}.`,
    "Output one JSON object only. Never answer the business question, generate SQL, or request a write operation.",
    `Available tools: ${QUERY_PLAN_TOOLS.map((tool) => `${tool} (${toolDescriptions[tool]})`).join("; ")}.`,
    `Allowed time kinds: ${QUERY_PLAN_TIME_KINDS.join(", ")}. Preserve relative calendar meaning; use end_of_current_month instead of calculating days.`,
    "Only absolute_date and date_range may contain startDate/endDate. Use null dates on relative time kinds.",
    `Allowed metrics: ${QUERY_PLAN_METRICS.join(", ")}. Allowed receivable states: ${QUERY_PLAN_RECEIVABLE_STATES.join(", ")}.`,
    "Use buildingCode like SACSI11. Ask one concise clarification question only when a missing or ambiguous fact materially changes the result.",
    "A plan may contain up to five calls. A clarification plan may contain zero calls; otherwise at least one call is required.",
    "Every arguments object must contain domain, buildingCode, unitNo, customerName, time, receivableState, metrics, and limit. Every time object must contain kind, value, startDate, and endDate.",
    "Schema example: {\"version\":2,\"objective\":\"Find unpaid leases before month end\",\"needsClarification\":false,\"clarificationQuestion\":null,\"calls\":[{\"id\":\"receivables\",\"tool\":\"list_receivables\",\"arguments\":{\"domain\":\"lease\",\"buildingCode\":\"SACSI11\",\"unitNo\":null,\"customerName\":null,\"time\":{\"kind\":\"end_of_current_month\",\"value\":null,\"startDate\":null,\"endDate\":null},\"receivableState\":\"due_in_window\",\"metrics\":[\"list\",\"amount_outstanding\"],\"limit\":100}}],\"confidence\":0.94}",
  ].join(" ");
}

function plannerUserInput(query: string, turns: QueryPlannerConversationTurn[]) {
  return JSON.stringify({
    currentUserMessage: query,
    recentConversation: turns.slice(-6).map((turn) => ({
      priorUserMessage: turn.userText.trim().slice(0, 500),
      priorBusinessContext: {
        buildingCode: turn.context.buildingCode ?? null,
        unitNo: turn.context.unitNo ?? null,
        customerName: turn.context.customerName ?? null,
        domain: turn.context.domain ?? null,
      },
    })),
  });
}

export async function planWorkbenchQueryV2(input: {
  query: string;
  asOfDate: string;
  locale: Locale;
  history: QueryPlannerConversationTurn[];
}): Promise<QueryPlanV2 | null> {
  if (process.env.AI_QUERY_PLANNER_SHADOW_ENABLED !== "true") return null;
  const provider = (process.env.AI_QUERY_PLANNER_PROVIDER || process.env.AI_QUERY_PROVIDER || "deepseek").toLowerCase();
  if (provider !== "deepseek" || !process.env.DEEPSEEK_API_KEY) return null;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.AI_QUERY_PLANNER_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: plannerPrompt({ asOfDate: input.asOfDate, locale: input.locale }) },
        { role: "user", content: plannerUserInput(input.query, input.history) },
      ],
      response_format: { type: "json_object" },
      thinking: process.env.AI_QUERY_PLANNER_THINKING_ENABLED === "true" ? { type: "enabled" } : { type: "disabled" },
      max_tokens: 1_200,
      stream: false,
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;
  try { return normalizeQueryPlanV2(JSON.parse(content)); } catch { return null; }
}
