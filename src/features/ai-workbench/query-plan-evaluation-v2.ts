import type { Locale } from "@/lib/i18n";
import type { QueryPlanReceivableState, QueryPlanTimeKind, QueryPlanTool, QueryPlanV2 } from "./query-plan";

export interface QueryPlanEvaluationExpectedCall {
  tool: QueryPlanTool;
  domain: "all" | "daily" | "lease" | "sale";
  buildingCode?: string | null;
  unitNo?: string | null;
  customerName?: string | null;
  timeKind?: QueryPlanTimeKind;
  startDate?: string | null;
  endDate?: string | null;
  receivableState?: QueryPlanReceivableState | null;
}

export interface QueryPlanEvaluationCaseV2 {
  id: string;
  locale: Locale;
  query: string;
  expected: {
    needsClarification: boolean;
    calls: QueryPlanEvaluationExpectedCall[];
  };
}

export interface QueryPlanEvaluationCaseResult {
  id: string;
  passed: boolean;
  checks: number;
  failures: string[];
  plan: QueryPlanV2 | null;
}

function normalizedText(value: string | null | undefined) {
  return value?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/\s+/g, " ").trim() ?? null;
}

export function evaluateQueryPlanCase(testCase: QueryPlanEvaluationCaseV2, plan: QueryPlanV2 | null): QueryPlanEvaluationCaseResult {
  const failures: string[] = [];
  let checks = 1;
  if (!plan) {
    return { id: testCase.id, passed: false, checks, failures: ["planner_unavailable"], plan };
  }
  if (plan.needsClarification !== testCase.expected.needsClarification) failures.push("needsClarification");
  checks += 1;
  if (plan.calls.length !== testCase.expected.calls.length) failures.push("callCount");

  testCase.expected.calls.forEach((expected, index) => {
    const actual = plan.calls[index];
    if (!actual) return;
    const compare = (field: string, expectedValue: unknown, actualValue: unknown) => {
      if (expectedValue === undefined) return;
      checks += 1;
      if (expectedValue !== actualValue) failures.push(`calls.${index}.${field}`);
    };
    compare("tool", expected.tool, actual.tool);
    compare("domain", expected.domain, actual.arguments.domain);
    compare("buildingCode", expected.buildingCode, actual.arguments.buildingCode);
    compare("unitNo", expected.unitNo, actual.arguments.unitNo);
    if (expected.customerName !== undefined) {
      checks += 1;
      if (normalizedText(expected.customerName) !== normalizedText(actual.arguments.customerName)) failures.push(`calls.${index}.customerName`);
    }
    compare("time.kind", expected.timeKind, actual.arguments.time.kind);
    compare("time.startDate", expected.startDate, actual.arguments.time.startDate);
    compare("time.endDate", expected.endDate, actual.arguments.time.endDate);
    compare("receivableState", expected.receivableState, actual.arguments.receivableState);
  });

  return { id: testCase.id, passed: failures.length === 0, checks, failures, plan };
}

export async function runQueryPlanEvaluation(input: {
  cases: QueryPlanEvaluationCaseV2[];
  asOfDate: string;
  plan: (testCase: QueryPlanEvaluationCaseV2, asOfDate: string) => Promise<QueryPlanV2 | null>;
}) {
  const results = await Promise.all(input.cases.map(async (testCase) => (
    evaluateQueryPlanCase(testCase, await input.plan(testCase, input.asOfDate))
  )));
  const passed = results.filter((result) => result.passed).length;
  const checks = results.reduce((sum, result) => sum + result.checks, 0);
  const failedChecks = results.reduce((sum, result) => sum + result.failures.length, 0);
  return {
    total: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    checkAccuracy: checks ? (checks - failedChecks) / checks : 0,
    results,
  };
}
