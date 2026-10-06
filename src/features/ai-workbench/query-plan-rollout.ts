import { compileQueryPlanCall } from "./query-tool-adapter";
import type { QueryPlanV2 } from "./query-plan";

export const DEFAULT_SINGLE_TOOL_MIN_CONFIDENCE = 0.82;

export type QueryPlanRolloutDecision =
  | { mode: "execute_v2"; plan: QueryPlanV2 }
  | { mode: "clarify"; question: string; plan: QueryPlanV2 }
  | {
      mode: "legacy";
      reason:
        | "rollout_disabled"
        | "planner_unavailable"
        | "clarification_not_enabled"
        | "multi_tool_not_enabled"
        | "confidence_below_threshold"
        | "incompatible_call";
    };

/**
 * Keeps the first rollout deliberately narrow. Model output is only eligible
 * to execute when one read-only call passes the same compiler used by the
 * executor. Permission checks still happen later against the current user.
 */
export function selectQueryPlanRollout(input: {
  enabled: boolean;
  plan: QueryPlanV2 | null;
  asOfDate: string;
  minimumConfidence?: number;
  multiToolEnabled?: boolean;
  clarificationEnabled?: boolean;
}): QueryPlanRolloutDecision {
  if (!input.enabled) return { mode: "legacy", reason: "rollout_disabled" };
  if (!input.plan) return { mode: "legacy", reason: "planner_unavailable" };
  if (input.plan.needsClarification) {
    if (input.clarificationEnabled && input.plan.clarificationQuestion?.trim()) {
      return { mode: "clarify", question: input.plan.clarificationQuestion, plan: input.plan };
    }
    return { mode: "legacy", reason: "clarification_not_enabled" };
  }
  if (input.plan.calls.length < 1 || input.plan.calls.length > 5 ||
    (!input.multiToolEnabled && input.plan.calls.length !== 1)) return { mode: "legacy", reason: "multi_tool_not_enabled" };
  if (input.plan.confidence < (input.minimumConfidence ?? DEFAULT_SINGLE_TOOL_MIN_CONFIDENCE)) {
    return { mode: "legacy", reason: "confidence_below_threshold" };
  }
  if (input.plan.calls.some(call => !compileQueryPlanCall(call, input.asOfDate, input.plan!.confidence).ok)) {
    return { mode: "legacy", reason: "incompatible_call" };
  }
  return { mode: "execute_v2", plan: input.plan };
}
