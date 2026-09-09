import type { WorkbenchIntent } from "./types";
import { resolveQueryPlanTime, type QueryPlanCall, type QueryPlanTool, type QueryPlanV2, type ResolvedTimeRange } from "./query-plan";

export type QueryToolPermission = "units:read" | "daily_rentals:read" | "leases:read" | "sales:read" | "finance:read";

export type QueryPlanCompileResult =
  | { ok: true; callId: string; tool: QueryPlanTool; intent: WorkbenchIntent; resolvedTime: ResolvedTimeRange; permissions: QueryToolPermission[] }
  | { ok: false; callId: string; tool: QueryPlanTool; code: "missing_unit" | "unsupported_customer_filter" | "unsupported_time_window" | "time_window_too_large"; message: string };

function daysBetween(startDate: string, endDate: string) {
  return Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
}

function pointDate(range: ResolvedTimeRange, asOfDate: string) {
  if (range.startDate === null && range.endDate === null) return asOfDate;
  if (range.startDate && range.startDate === range.endDate) return range.startDate;
  return null;
}

export function requiredPermissionsForQueryTool(call: QueryPlanCall): QueryToolPermission[] {
  if (call.tool === "get_daily_status" || call.tool === "list_daily_movements") return ["daily_rentals:read"];
  if (call.tool === "list_lease_expirations") return ["leases:read"];
  if (call.tool === "get_unit_snapshot") {
    // The current snapshot service reads every active business stream and its
    // confirmed financial balance, so V2 deliberately requires all scopes.
    return ["units:read", "daily_rentals:read", "leases:read", "sales:read", "finance:read"];
  }
  if (call.arguments.domain === "daily") return ["daily_rentals:read"];
  if (call.arguments.domain === "lease") return ["leases:read"];
  if (call.arguments.domain === "sale") return ["sales:read"];
  return ["finance:read"];
}

function failure(call: QueryPlanCall, code: Extract<QueryPlanCompileResult, { ok: false }>["code"], message: string): QueryPlanCompileResult {
  return { ok: false, callId: call.id, tool: call.tool, code, message };
}

/**
 * Compiles a validated V2 call to the existing read-only query service.
 *
 * This adapter is intentionally honest about legacy gaps: it rejects filters
 * and calendar windows the old service cannot execute exactly instead of
 * silently broadening them. It grants no execution authority by itself.
 */
export function compileQueryPlanCall(call: QueryPlanCall, asOfDate: string, confidence: number): QueryPlanCompileResult {
  const resolvedTime = resolveQueryPlanTime(call.arguments.time, asOfDate);
  const permissions = requiredPermissionsForQueryTool(call);
  if (call.arguments.customerName) {
    return failure(call, "unsupported_customer_filter", "The current read service cannot safely filter by customer name.");
  }

  let kind: WorkbenchIntent["kind"];
  let executionDate = asOfDate;
  let days = 15;

  if (call.tool === "get_daily_status" || call.tool === "list_daily_movements") {
    const date = pointDate(resolvedTime, asOfDate);
    if (!date) return failure(call, "unsupported_time_window", "The current daily service accepts one exact day, not a date range.");
    executionDate = date;
    days = 1;
    kind = call.tool === "get_daily_status" ? "daily_status" : "daily_movements";
  } else if (call.tool === "get_unit_snapshot") {
    if (!call.arguments.unitNo) return failure(call, "missing_unit", "A unit snapshot requires an exact unit number.");
    if (!pointDate(resolvedTime, asOfDate)) return failure(call, "unsupported_time_window", "The current unit snapshot only represents current state.");
    kind = "unit_snapshot";
  } else if (call.tool === "list_lease_expirations") {
    if (!resolvedTime.startDate || !resolvedTime.endDate || resolvedTime.startDate !== asOfDate) {
      return failure(call, "unsupported_time_window", "The current lease service only supports a window starting at the reference date.");
    }
    days = daysBetween(asOfDate, resolvedTime.endDate);
    if (days < 1 || days > 90) return failure(call, "time_window_too_large", "The current lease service supports windows from 1 to 90 days.");
    kind = "lease_expiring";
  } else {
    const state = call.arguments.receivableState;
    kind = state === "overdue" ? "receivable_overdue" : state === "outstanding" ? "receivable_outstanding" : "receivable_due_soon";
    if (state === "due_in_window") {
      if (!resolvedTime.startDate || !resolvedTime.endDate || resolvedTime.startDate !== asOfDate) {
        return failure(call, "unsupported_time_window", "The current receivable service only supports a due window starting at the reference date.");
      }
      days = daysBetween(asOfDate, resolvedTime.endDate);
      if (days < 1 || days > 90) return failure(call, "time_window_too_large", "The current receivable service supports windows from 1 to 90 days.");
    } else {
      const date = pointDate(resolvedTime, asOfDate);
      if (!date) return failure(call, "unsupported_time_window", "Outstanding and overdue queries require one reference date.");
      executionDate = date;
    }
  }

  return {
    ok: true,
    callId: call.id,
    tool: call.tool,
    resolvedTime,
    permissions,
    intent: {
      kind,
      domain: call.arguments.domain,
      buildingCode: call.arguments.buildingCode,
      unitNo: call.arguments.unitNo,
      customerName: null,
      days,
      asOfDate: executionDate,
      confidence,
      source: "deepseek",
    },
  };
}

export function summarizeQueryPlanCompatibility(plan: QueryPlanV2 | null, asOfDate: string) {
  if (!plan) return { status: "unavailable" as const, calls: [] };
  if (plan.needsClarification) return { status: "needs_clarification" as const, calls: [] };
  const calls = plan.calls.map((call) => {
    const compiled = compileQueryPlanCall(call, asOfDate, plan.confidence);
    return compiled.ok
      ? { callId: compiled.callId, tool: compiled.tool, status: "compatible" as const }
      : { callId: compiled.callId, tool: compiled.tool, status: "incompatible" as const, code: compiled.code };
  });
  return {
    status: calls.every((call) => call.status === "compatible") ? "compatible" as const : "incompatible" as const,
    calls,
  };
}
