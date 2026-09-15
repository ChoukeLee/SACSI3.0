import { getBusinessActionDefinition } from "./registry";

export type OperatorInputSource =
  | "natural_language"
  | "manual_form"
  | "excel_screenshot"
  | "structured_batch";

export type OperatorRequestScope = "business_data" | "system_change";

export type OperatorExecutionDecision =
  | "execute"
  | "confirm"
  | "block_and_report";

export type OperatorExecutionReason =
  | "read_only"
  | "routine_business_action"
  | "high_risk_business_action"
  | "untrusted_extraction"
  | "batch_write"
  | "exceptional_business_case"
  | "system_change_requires_developer"
  | "unknown_business_action";

export interface OperatorExecutionPolicyInput {
  actionName: string;
  inputSource: OperatorInputSource;
  scope?: OperatorRequestScope;
  exceptionalBusinessCase?: boolean;
}

export interface OperatorExecutionPolicyResult {
  decision: OperatorExecutionDecision;
  reason: OperatorExecutionReason;
  actionName: string;
  risk: "L0" | "L1" | "L2" | "L3" | null;
  write: boolean | null;
}

/**
 * Shared policy for the external operator connector and the in-app fallback.
 *
 * This decides whether a request needs confirmation; it does not grant
 * authorization. The authenticated business action and database policies must
 * still allow the caller, and every write must keep its idempotency and
 * post-execution verification checks.
 */
export function decideOperatorExecution(
  input: OperatorExecutionPolicyInput,
): OperatorExecutionPolicyResult {
  if (input.scope === "system_change") {
    return {
      decision: "block_and_report",
      reason: "system_change_requires_developer",
      actionName: input.actionName,
      risk: null,
      write: null,
    };
  }

  const definition = getBusinessActionDefinition(input.actionName);
  if (!definition) {
    return {
      decision: "block_and_report",
      reason: "unknown_business_action",
      actionName: input.actionName,
      risk: null,
      write: null,
    };
  }

  if (!definition.write) {
    return {
      decision: "execute",
      reason: "read_only",
      actionName: input.actionName,
      risk: definition.risk,
      write: false,
    };
  }

  if (input.inputSource === "excel_screenshot") {
    return {
      decision: "confirm",
      reason: "untrusted_extraction",
      actionName: input.actionName,
      risk: definition.risk,
      write: true,
    };
  }

  if (input.inputSource === "structured_batch") {
    return {
      decision: "confirm",
      reason: "batch_write",
      actionName: input.actionName,
      risk: definition.risk,
      write: true,
    };
  }

  if (input.exceptionalBusinessCase) {
    return {
      decision: "confirm",
      reason: "exceptional_business_case",
      actionName: input.actionName,
      risk: definition.risk,
      write: true,
    };
  }

  if (definition.risk === "L3") {
    return {
      decision: "confirm",
      reason: "high_risk_business_action",
      actionName: input.actionName,
      risk: definition.risk,
      write: true,
    };
  }

  return {
    decision: "execute",
    reason: "routine_business_action",
    actionName: input.actionName,
    risk: definition.risk,
    write: true,
  };
}

