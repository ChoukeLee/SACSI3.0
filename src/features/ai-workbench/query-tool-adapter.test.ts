import { describe, expect, it } from "vitest";
import { compileQueryPlanCall, requiredPermissionsForQueryTool, summarizeQueryPlanCompatibility } from "./query-tool-adapter";
import type { QueryPlanCall, QueryPlanV2 } from "./query-plan";

function call(overrides: Partial<QueryPlanCall> = {}, argumentOverrides: Partial<QueryPlanCall["arguments"]> = {}): QueryPlanCall {
  return {
    id: "call_1",
    tool: "list_receivables",
    arguments: {
      domain: "lease",
      buildingCode: "SACSI11",
      unitNo: null,
      customerName: null,
      time: { kind: "end_of_current_month", value: null, startDate: null, endDate: null },
      receivableState: "due_in_window",
      metrics: ["list", "amount_outstanding"],
      limit: 100,
      ...argumentOverrides,
    },
    ...overrides,
  };
}

describe("query plan tool adapter", () => {
  it("compiles a semantic month-end receivable window without model date arithmetic", () => {
    const result = compileQueryPlanCall(call(), "2026-09-09", 0.93);
    expect(result).toMatchObject({
      ok: true,
      tool: "list_receivables",
      resolvedTime: { startDate: "2026-09-09", endDate: "2026-09-30", timezone: "Africa/Abidjan" },
      intent: { kind: "receivable_due_soon", domain: "lease", buildingCode: "SACSI11", days: 21, asOfDate: "2026-09-09", source: "deepseek" },
      permissions: ["leases:read"],
    });
  });

  it("compiles one-day daily tools and preserves an explicit date", () => {
    const result = compileQueryPlanCall(call(
      { tool: "list_daily_movements" },
      { domain: "daily", receivableState: null, time: { kind: "absolute_date", value: null, startDate: "2026-09-12", endDate: null } },
    ), "2026-09-09", 0.9);
    expect(result).toMatchObject({ ok: true, intent: { kind: "daily_movements", asOfDate: "2026-09-12" }, permissions: ["daily_rentals:read"] });
    expect(compileQueryPlanCall(call(
      { tool: "list_daily_movements" },
      { domain: "daily", receivableState: null, time: { kind: "unspecified", value: null, startDate: null, endDate: null } },
    ), "2026-09-09", 0.9)).toMatchObject({
      ok: true,
      resolvedTime: { startDate: "2026-09-09", endDate: "2026-09-09", startInclusive: true, endInclusive: true },
    });
  });

  it("supports exact calendar windows and customer filters where the tool can honor them", () => {
    expect(compileQueryPlanCall(call({ tool: "list_daily_movements" }, { domain: "daily", receivableState: null, time: { kind: "next_calendar_week", value: null, startDate: null, endDate: null } }), "2026-09-09", 0.9)).toMatchObject({
      ok: true,
      resolvedTime: { startDate: "2026-09-14", endDate: "2026-09-20" },
    });
    expect(compileQueryPlanCall(call({}, { customerName: "Example Customer" }), "2026-09-09", 0.9)).toMatchObject({ ok: true });
    expect(compileQueryPlanCall(call({ tool: "get_daily_status" }, { domain: "daily", customerName: "Example Customer", receivableState: null, time: { kind: "today", value: null, startDate: null, endDate: null } }), "2026-09-09", 0.9)).toMatchObject({ ok: false, code: "unsupported_customer_filter" });
  });

  it("requires a unit and all currently exposed snapshot scopes", () => {
    const snapshot = call({ tool: "get_unit_snapshot" }, { domain: "all", receivableState: null, time: { kind: "today", value: null, startDate: null, endDate: null } });
    expect(compileQueryPlanCall(snapshot, "2026-09-09", 0.9)).toMatchObject({ ok: false, code: "missing_unit" });
    expect(requiredPermissionsForQueryTool({ ...snapshot, arguments: { ...snapshot.arguments, unitNo: "503" } })).toEqual([
      "units:read", "daily_rentals:read", "leases:read", "sales:read", "finance:read",
    ]);
  });

  it("summarizes execution compatibility without running a database query", () => {
    const plan: QueryPlanV2 = {
      version: 2,
      objective: "Compare due rent and next week's movements",
      needsClarification: false,
      clarificationQuestion: null,
      calls: [
        call(),
        call({ id: "movement", tool: "list_daily_movements" }, { domain: "daily", receivableState: null, time: { kind: "next_calendar_week", value: null, startDate: null, endDate: null } }),
      ],
      confidence: 0.91,
      provider: "deepseek",
    };
    expect(summarizeQueryPlanCompatibility(plan, "2026-09-09")).toEqual({
      status: "compatible",
      calls: [
        { callId: "call_1", tool: "list_receivables", status: "compatible" },
        { callId: "movement", tool: "list_daily_movements", status: "compatible" },
      ],
    });
  });
});
