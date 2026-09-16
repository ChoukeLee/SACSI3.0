import { describe, expect, it } from "vitest";
import type { QueryPlanV2 } from "./query-plan";
import { selectQueryPlanRollout } from "./query-plan-rollout";

function plan(overrides: Partial<QueryPlanV2> = {}): QueryPlanV2 {
  return {
    version: 2,
    objective: "Review lease receivables",
    needsClarification: false,
    clarificationQuestion: null,
    calls: [{
      id: "receivables",
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
      },
    }],
    confidence: 0.9,
    provider: "deepseek",
    ...overrides,
  };
}

describe("single-tool query plan rollout", () => {
  it("remains inert until explicitly enabled", () => {
    expect(selectQueryPlanRollout({ enabled: false, plan: plan(), asOfDate: "2026-09-09" }))
      .toEqual({ mode: "legacy", reason: "rollout_disabled" });
  });

  it("accepts one high-confidence compatible read call", () => {
    expect(selectQueryPlanRollout({ enabled: true, plan: plan(), asOfDate: "2026-09-09" }).mode)
      .toBe("execute_v2");
  });

  it("falls back for low confidence, clarification, multiple calls or incompatible arguments", () => {
    expect(selectQueryPlanRollout({ enabled: true, plan: plan({ confidence: 0.8 }), asOfDate: "2026-09-09" }))
      .toEqual({ mode: "legacy", reason: "confidence_below_threshold" });
    expect(selectQueryPlanRollout({ enabled: true, plan: plan({ needsClarification: true, clarificationQuestion: "Which building?", calls: [] }), asOfDate: "2026-09-09" }))
      .toEqual({ mode: "legacy", reason: "clarification_not_enabled" });
    const twoCalls = [...plan().calls, { ...plan().calls[0], id: "second" }];
    expect(selectQueryPlanRollout({ enabled: true, plan: plan({ calls: twoCalls }), asOfDate: "2026-09-09" }))
      .toEqual({ mode: "legacy", reason: "multi_tool_not_enabled" });
    const incompatible = plan();
    incompatible.calls[0] = {
      ...incompatible.calls[0],
      tool: "get_daily_status",
      arguments: { ...incompatible.calls[0].arguments, domain: "daily", customerName: "Example", receivableState: null },
    };
    expect(selectQueryPlanRollout({ enabled: true, plan: incompatible, asOfDate: "2026-09-09" }))
      .toEqual({ mode: "legacy", reason: "incompatible_call" });
  });
});
