import { describe, it, expect } from "vitest";
import { combineQueryResults } from "../src/features/ai-workbench/multi-query-result";
import type { WorkbenchResult } from "../src/features/ai-workbench/types";
import type { QueryPlanV2 } from "../src/features/ai-workbench/query-plan";
import { selectQueryPlanRollout } from "../src/features/ai-workbench/query-plan-rollout";

const result = {
  kind: "query_result",
  query: "test",
  intent: {
    kind: "receivable_outstanding",
    domain: "lease",
    buildingCode: null,
    unitNo: null,
    customerName: null,
    days: 1,
    asOfDate: "2026-10-06",
    confidence: 0.9,
    source: "deepseek",
  },
  title: "Lease",
  answer: "100 XOF",
  scope: "11#",
  metrics: [{ label: "Balance", value: "100", tone: "neutral" }],
  table: null,
  evidence: [],
  warnings: [],
  generatedAt: "2026-10-06",
  resultCount: 1,
} as WorkbenchResult;
const plan: QueryPlanV2 = {
  version: 2,
  objective: "Read",
  needsClarification: false,
  clarificationQuestion: null,
  provider: "deepseek",
  confidence: 0.9,
  calls: [
    {
      id: "first",
      tool: "list_receivables",
      arguments: {
        domain: "lease",
        buildingCode: null,
        unitNo: null,
        customerName: null,
        time: { kind: "today", value: null, startDate: null, endDate: null },
        receivableState: "outstanding",
        metrics: ["list"],
        limit: 100,
      },
    },
  ],
};
describe("multi-query read-only rollout", () => {
  it("never sums overlapping data", () => {
    const combined = combineQueryResults("combined", [result, result], "zh");
    expect(combined.metrics).toEqual([]);
    expect(combined.resultCount).toBe(0);
    expect(combined.sections).toHaveLength(2);
  });
  it("executes all compatible calls only with the multi-tool flag", () => {
    const multiple = { ...plan, calls: [...plan.calls, { ...plan.calls[0], id: "second" }] };
    expect(
      selectQueryPlanRollout({
        enabled: true,
        multiToolEnabled: true,
        plan: multiple,
        asOfDate: "2026-10-06",
      }).mode,
    ).toBe("execute_v2");
    expect(
      selectQueryPlanRollout({ enabled: true, plan: multiple, asOfDate: "2026-10-06" }).mode,
    ).toBe("legacy");
  });
  it("a later incompatible call blocks the whole plan", () => {
    const invalid = {
      ...plan,
      calls: [
        ...plan.calls,
        {
          ...plan.calls[0],
          id: "bad",
          tool: "get_daily_status" as const,
          arguments: { ...plan.calls[0].arguments, customerName: "test" },
        },
      ],
    };
    expect(
      selectQueryPlanRollout({
        enabled: true,
        multiToolEnabled: true,
        plan: invalid,
        asOfDate: "2026-10-06",
      }),
    ).toMatchObject({ mode: "legacy", reason: "incompatible_call" });
  });
  it("clarification is surfaced without an executable call", () => {
    expect(
      selectQueryPlanRollout({
        enabled: true,
        clarificationEnabled: true,
        plan: { ...plan, needsClarification: true, clarificationQuestion: "哪一栋？", calls: [] },
        asOfDate: "2026-10-06",
      }),
    ).toMatchObject({ mode: "clarify", question: "哪一栋？" });
  });
});
