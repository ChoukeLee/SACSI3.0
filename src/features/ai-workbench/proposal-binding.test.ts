import { describe, expect, it } from "vitest";
import { assertCleaningProposalBinding } from "./proposal-binding";

const proposal = {
  action_name: "complete_daily_cleaning",
  target: { buildingId: "building-11", unitId: "unit-906" },
  action_input: { taskId: "task-906" },
  status: "proposed",
  version: 1,
};

describe("assertCleaningProposalBinding", () => {
  it("returns the bound building for the exact reviewed target", () => {
    expect(assertCleaningProposalBinding(proposal, {
      action: "complete_daily_cleaning",
      taskId: "task-906",
      unitId: "unit-906",
      expectedVersion: 1,
    })).toEqual({ buildingId: "building-11" });
  });

  it.each([
    ["action", { action: "check_in_daily_booking" }],
    ["task", { taskId: "task-905" }],
    ["unit", { unitId: "unit-905" }],
    ["version", { expectedVersion: 2 }],
  ])("rejects a mismatched %s", (_label, override) => {
    expect(() => assertCleaningProposalBinding(proposal, {
      action: "complete_daily_cleaning",
      taskId: "task-906",
      unitId: "unit-906",
      expectedVersion: 1,
      ...override,
    })).toThrow("proposalTargetMismatch");
  });

  it("rejects a proposal that is no longer awaiting confirmation", () => {
    expect(() => assertCleaningProposalBinding({ ...proposal, status: "executing" }, {
      action: "complete_daily_cleaning",
      taskId: "task-906",
      unitId: "unit-906",
      expectedVersion: 1,
    })).toThrow("proposalTargetMismatch");
  });
});
