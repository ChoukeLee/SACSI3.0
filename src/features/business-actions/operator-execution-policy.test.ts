import { describe, expect, it } from "vitest";
import { decideOperatorExecution } from "./operator-execution-policy";

describe("operator execution policy", () => {
  it("executes read-only queries without confirmation", () => {
    expect(decideOperatorExecution({
      actionName: "query_daily_booking",
      inputSource: "natural_language",
    })).toMatchObject({ decision: "execute", reason: "read_only", risk: "L0", write: false });
  });

  it("executes routine natural-language business writes without a second confirmation", () => {
    for (const actionName of ["record_daily_payment", "extend_daily_stay", "record_lease_rent", "record_sale_payment"]) {
      expect(decideOperatorExecution({ actionName, inputSource: "natural_language" }))
        .toMatchObject({ decision: "execute", reason: "routine_business_action", write: true });
    }
  });

  it("requires confirmation for high-risk corrections and reversals", () => {
    for (const actionName of ["reverse_daily_payment", "correct_lease_payment", "terminate_sale_contract"]) {
      expect(decideOperatorExecution({ actionName, inputSource: "natural_language" }))
        .toMatchObject({ decision: "confirm", reason: "high_risk_business_action", risk: "L3" });
    }
  });

  it("requires confirmation for screenshot-derived writes regardless of action risk", () => {
    expect(decideOperatorExecution({
      actionName: "record_lease_rent",
      inputSource: "excel_screenshot",
    })).toMatchObject({ decision: "confirm", reason: "untrusted_extraction", risk: "L2" });
  });

  it("requires one confirmation before a structured batch write", () => {
    expect(decideOperatorExecution({
      actionName: "record_daily_payment",
      inputSource: "structured_batch",
    })).toMatchObject({ decision: "confirm", reason: "batch_write" });
  });

  it("requires confirmation for an exceptional case using a known business action", () => {
    expect(decideOperatorExecution({
      actionName: "record_property_fee",
      inputSource: "natural_language",
      exceptionalBusinessCase: true,
    })).toMatchObject({ decision: "confirm", reason: "exceptional_business_case" });
  });

  it("blocks system changes and produces a report path", () => {
    expect(decideOperatorExecution({
      actionName: "alter_database_schema",
      inputSource: "natural_language",
      scope: "system_change",
    })).toEqual({
      decision: "block_and_report",
      reason: "system_change_requires_developer",
      actionName: "alter_database_schema",
      risk: null,
      write: null,
    });
  });

  it("blocks unknown actions instead of turning natural language into arbitrary database access", () => {
    expect(decideOperatorExecution({
      actionName: "run_sql",
      inputSource: "natural_language",
    })).toMatchObject({ decision: "block_and_report", reason: "unknown_business_action" });
  });
});

