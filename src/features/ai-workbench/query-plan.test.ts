import { describe, expect, it } from "vitest";
import { normalizeQueryPlanV2, resolveQueryPlanTime, summarizeShadowPlan, type QueryPlanTimeExpression } from "./query-plan";

const baseArguments = {
  domain: "lease",
  buildingCode: "sacsi11",
  unitNo: null,
  customerName: null,
  time: { kind: "end_of_current_month", value: null, startDate: null, endDate: null },
  receivableState: "due_in_window",
  metrics: ["list", "amount_outstanding"],
  limit: 100,
};

describe("query plan v2", () => {
  it("accepts a normalized multi-tool read plan", () => {
    const plan = normalizeQueryPlanV2({
      version: 2, objective: "Review building operations and outstanding rent",
      needsClarification: false, clarificationQuestion: null,
      calls: [
        { id: "status", tool: "get_daily_status", arguments: { ...baseArguments, domain: "daily", receivableState: null, metrics: ["count", "occupancy_rate"] } },
        { id: "rent", tool: "list_receivables", arguments: baseArguments },
      ], confidence: 0.92,
    });
    expect(plan?.calls).toHaveLength(2);
    expect(plan?.calls[1].arguments.buildingCode).toBe("SACSI11");
    expect(summarizeShadowPlan(plan)).toMatchObject({
      status: "planned",
      version: 2,
      calls: [
        { tool: "get_daily_status", domain: "daily", buildingCode: "SACSI11" },
        { tool: "list_receivables", domain: "lease", time: { kind: "end_of_current_month" } },
      ],
      callCount: 2,
      confidence: 0.92,
    });
  });

  it("accepts a clarification without inventing a tool call", () => {
    const plan = normalizeQueryPlanV2({
      version: 2, objective: "Find the referenced room", needsClarification: true,
      clarificationQuestion: "你指的是哪一栋楼、哪一个房间？", calls: [], confidence: 0.45,
    });
    expect(plan?.needsClarification).toBe(true);
    expect(plan?.calls).toEqual([]);
  });

  it("rejects unknown tools, invalid dates and unbounded calls", () => {
    const common = { version: 2, objective: "x", needsClarification: false, clarificationQuestion: null, confidence: 0.9 };
    expect(normalizeQueryPlanV2({ ...common, calls: [{ id: "x", tool: "run_sql", arguments: baseArguments }] })).toBeNull();
    expect(normalizeQueryPlanV2({ ...common, calls: [{ id: "x", tool: "list_receivables", arguments: { ...baseArguments, time: { kind: "date_range", value: null, startDate: "2026-02-31", endDate: "2026-03-01" } } }] })).toBeNull();
    expect(normalizeQueryPlanV2({ ...common, calls: Array.from({ length: 6 }, (_, index) => ({ id: `x${index}`, tool: "list_receivables", arguments: baseArguments })) })).toBeNull();
  });
});

describe("query plan time resolver", () => {
  const resolve = (time: Partial<QueryPlanTimeExpression>) => resolveQueryPlanTime({ kind: "unspecified", value: null, startDate: null, endDate: null, ...time }, "2026-09-09");

  it("preserves month-end semantics and resolves them in application code", () => {
    expect(resolve({ kind: "end_of_current_month" })).toEqual({ startDate: "2026-09-09", endDate: "2026-09-30", startInclusive: false, endInclusive: true, timezone: "Africa/Abidjan" });
  });

  it("resolves rolling days separately from calendar weeks", () => {
    expect(resolve({ kind: "next_days", value: 14 }).endDate).toBe("2026-09-23");
    expect(resolve({ kind: "next_calendar_week" })).toMatchObject({ startDate: "2026-09-14", endDate: "2026-09-20" });
  });

  it("resolves current and previous calendar months", () => {
    expect(resolve({ kind: "current_calendar_month" })).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(resolve({ kind: "previous_calendar_month" })).toMatchObject({ startDate: "2026-08-01", endDate: "2026-08-31" });
  });
});
