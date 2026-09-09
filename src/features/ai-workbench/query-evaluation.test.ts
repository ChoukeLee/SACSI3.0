import { describe, expect, it } from "vitest";
import { parseWorkbenchIntent } from "./intent-parser";
import { QUERY_EVALUATION_CASES } from "./query-evaluation-cases";
import { WORKBENCH_QUERY_KINDS } from "./types";

describe("AI query expression evaluation", () => {
  it.each(QUERY_EVALUATION_CASES)("maps $query to the expected safe intent", ({ query, expected }) => {
    expect(parseWorkbenchIntent(query, "2026-09-09")).toMatchObject(expected);
  });

  it("keeps the shared query catalog complete", () => {
    expect(WORKBENCH_QUERY_KINDS).toEqual([
      "daily_status",
      "daily_movements",
      "lease_expiring",
      "receivable_overdue",
      "receivable_outstanding",
      "receivable_due_soon",
      "unit_snapshot",
      "unsupported",
    ]);
  });
});
