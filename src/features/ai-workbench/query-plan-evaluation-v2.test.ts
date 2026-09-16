import { describe, expect, it } from "vitest";
import { QUERY_PLAN_EVALUATION_CASES_V2 } from "./query-plan-evaluation-cases-v2";
import { evaluateQueryPlanCase, runQueryPlanEvaluation } from "./query-plan-evaluation-v2";
import type { QueryPlanV2 } from "./query-plan";

function matchingPlan(index = 0): QueryPlanV2 {
  const testCase = QUERY_PLAN_EVALUATION_CASES_V2[index];
  return {
    version: 2,
    objective: "Evaluation fixture",
    needsClarification: testCase.expected.needsClarification,
    clarificationQuestion: testCase.expected.needsClarification ? "请说明业务范围。" : null,
    calls: testCase.expected.calls.map((expected, callIndex) => ({
      id: `call_${callIndex + 1}`,
      tool: expected.tool,
      arguments: {
        domain: expected.domain,
        buildingCode: expected.buildingCode ?? null,
        unitNo: expected.unitNo ?? null,
        customerName: expected.customerName ?? null,
        time: {
          kind: expected.timeKind ?? "unspecified",
          value: expected.timeKind === "next_days" ? 30 : null,
          startDate: expected.startDate ?? null,
          endDate: expected.endDate ?? null,
        },
        receivableState: expected.receivableState ?? null,
        metrics: ["list"],
        limit: 100,
      },
    })),
    confidence: 0.9,
    provider: "deepseek",
  };
}

describe("query plan v2 evaluation harness", () => {
  it("covers bilingual, temporal, customer, clarification and multi-tool behavior", () => {
    expect(QUERY_PLAN_EVALUATION_CASES_V2).toHaveLength(12);
    expect(new Set(QUERY_PLAN_EVALUATION_CASES_V2.map((item) => item.locale))).toEqual(new Set(["zh", "fr"]));
    expect(QUERY_PLAN_EVALUATION_CASES_V2.some((item) => item.expected.needsClarification)).toBe(true);
    expect(QUERY_PLAN_EVALUATION_CASES_V2.some((item) => item.expected.calls.length > 1)).toBe(true);
    expect(QUERY_PLAN_EVALUATION_CASES_V2.some((item) => item.expected.calls.some((call) => call.customerName))).toBe(true);
  });

  it("reports exact semantic mismatches without comparing free-form wording", () => {
    const testCase = QUERY_PLAN_EVALUATION_CASES_V2[0];
    const result = evaluateQueryPlanCase(testCase, matchingPlan(0));
    expect(result).toMatchObject({ passed: true, failures: [] });
    const wrong = matchingPlan(0);
    wrong.calls[0].arguments.time.kind = "next_days";
    expect(evaluateQueryPlanCase(testCase, wrong)).toMatchObject({ passed: false, failures: ["calls.0.time.kind"] });
  });

  it("aggregates case pass rate and field-level accuracy", async () => {
    const cases = QUERY_PLAN_EVALUATION_CASES_V2.slice(0, 2);
    const report = await runQueryPlanEvaluation({
      cases,
      asOfDate: "2026-09-09",
      plan: async (testCase) => testCase.id === cases[0].id ? matchingPlan(0) : null,
    });
    expect(report).toMatchObject({ total: 2, passed: 1, passRate: 0.5 });
    expect(report.checkAccuracy).toBeLessThan(1);
  });
});
