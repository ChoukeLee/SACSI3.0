import "server-only";

import { hasPermission, type CurrentUser } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";
import { executeWorkbenchQuery } from "./query-service";
import { compileQueryPlanCall, type QueryPlanCompileResult } from "./query-tool-adapter";
import type { QueryPlanTool, QueryPlanV2, ResolvedTimeRange } from "./query-plan";
import type { WorkbenchResult } from "./types";

export type QueryPlanExecutionResult =
  | { status: "needs_clarification"; question: string }
  | { status: "invalid_plan"; failures: Extract<QueryPlanCompileResult, { ok: false }>[] }
  | { status: "permission_denied"; callIds: string[] }
  | { status: "success"; results: Array<{ callId: string; tool: QueryPlanTool; resolvedTime: ResolvedTimeRange; result: WorkbenchResult }> };

/**
 * Executes only validated, read-only V2 calls through the existing query
 * service and the current authenticated user's permission set.
 *
 * This function is not connected to the production response path yet.
 */
export async function executeQueryPlanV2(input: {
  query: string;
  plan: QueryPlanV2;
  asOfDate: string;
  locale: Locale;
  user: CurrentUser;
}): Promise<QueryPlanExecutionResult> {
  if (input.plan.needsClarification) {
    return { status: "needs_clarification", question: input.plan.clarificationQuestion! };
  }

  const compiled = input.plan.calls.map((call) => compileQueryPlanCall(call, input.asOfDate, input.plan.confidence));
  const failures = compiled.filter((item): item is Extract<QueryPlanCompileResult, { ok: false }> => !item.ok);
  if (failures.length) return { status: "invalid_plan", failures };
  const executable = compiled.filter((item): item is Extract<QueryPlanCompileResult, { ok: true }> => item.ok);
  const denied = executable.filter((item) => item.permissions.some((permission) => !hasPermission(input.user, permission)));
  if (denied.length) return { status: "permission_denied", callIds: denied.map((item) => item.callId) };

  const results = await Promise.all(executable.map(async (item) => ({
    callId: item.callId,
    tool: item.tool,
    resolvedTime: item.resolvedTime,
    result: await executeWorkbenchQuery(input.query, item.intent, input.locale, {
      timeRange: item.resolvedTime,
      customerName: input.plan.calls.find((call) => call.id === item.callId)?.arguments.customerName ?? null,
      limit: input.plan.calls.find((call) => call.id === item.callId)?.arguments.limit ?? 100,
    }),
  })));
  return { status: "success", results };
}
