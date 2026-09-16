import { loadEnvConfig } from "@next/env";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { QUERY_PLAN_EVALUATION_CASES_V2 } from "./query-plan-evaluation-cases-v2";
import { runQueryPlanEvaluation } from "./query-plan-evaluation-v2";
import { planWorkbenchQueryV2 } from "./query-planner";

const liveEvaluationEnabled = process.env.AI_QUERY_PLANNER_LIVE_EVAL === "true";

describe.skipIf(!liveEvaluationEnabled)("query planner v2 live evaluation", () => {
  it("meets the configured semantic pass-rate gate on synthetic business questions", async () => {
    loadEnvConfig(process.cwd());
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("Query Plan V2 live evaluation requires DEEPSEEK_API_KEY in the local environment.");
    }
    process.env.AI_QUERY_PLANNER_SHADOW_ENABLED = "true";
    const report = await runQueryPlanEvaluation({
      cases: QUERY_PLAN_EVALUATION_CASES_V2,
      asOfDate: "2026-09-09",
      plan: (testCase, asOfDate) => planWorkbenchQueryV2({
        query: testCase.query,
        asOfDate,
        locale: testCase.locale,
        history: [],
      }),
    });
    const summary = report.results.map(({ id, passed, failures }) => ({ id, passed, failures }));
    console.info("Query Plan V2 live evaluation", JSON.stringify({
      total: report.total,
      passed: report.passed,
      passRate: report.passRate,
      checkAccuracy: report.checkAccuracy,
      cases: summary,
    }, null, 2));
    const minimumPassRate = Number(process.env.AI_QUERY_PLANNER_LIVE_EVAL_MIN_PASS_RATE ?? 0.8);
    expect(report.passRate).toBeGreaterThanOrEqual(minimumPassRate);
  }, 30_000);
});
