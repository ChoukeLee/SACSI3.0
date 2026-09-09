import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ hasPermission: vi.fn() }));
vi.mock("./query-service", () => ({ executeWorkbenchQuery: vi.fn() }));

import { hasPermission, type CurrentUser } from "@/lib/auth";
import { executeWorkbenchQuery } from "./query-service";
import { executeQueryPlanV2 } from "./query-tool-executor";
import type { QueryPlanCall, QueryPlanV2 } from "./query-plan";

const user = { id: "user-1", role: "admin", displayName: "Admin" } as CurrentUser;

function receivableCall(id: string, domain: "lease" | "sale" = "lease"): QueryPlanCall {
  return {
    id,
    tool: "list_receivables",
    arguments: {
      domain,
      buildingCode: "SACSI11",
      unitNo: null,
      customerName: null,
      time: { kind: "end_of_current_month", value: null, startDate: null, endDate: null },
      receivableState: "due_in_window",
      metrics: ["list", "amount_outstanding"],
      limit: 100,
    },
  };
}

function plan(calls: QueryPlanCall[]): QueryPlanV2 {
  return { version: 2, objective: "Review receivables", needsClarification: false, clarificationQuestion: null, calls, confidence: 0.9, provider: "deepseek" };
}

afterEach(() => vi.clearAllMocks());

describe("query plan v2 executor", () => {
  it("runs no query when any call is incompatible", async () => {
    vi.mocked(hasPermission).mockReturnValue(true);
    const incompatible = receivableCall("bad");
    incompatible.tool = "get_daily_status";
    incompatible.arguments.domain = "daily";
    incompatible.arguments.receivableState = null;
    incompatible.arguments.customerName = "Example Customer";
    const result = await executeQueryPlanV2({ query: "test", plan: plan([receivableCall("good"), incompatible]), asOfDate: "2026-09-09", locale: "zh", user });
    expect(result).toMatchObject({ status: "invalid_plan", failures: [{ callId: "bad", code: "unsupported_customer_filter" }] });
    expect(executeWorkbenchQuery).not.toHaveBeenCalled();
  });

  it("runs no query when any required permission is missing", async () => {
    vi.mocked(hasPermission).mockImplementation((_user, permission) => permission !== "sales:read");
    const result = await executeQueryPlanV2({ query: "test", plan: plan([receivableCall("lease"), receivableCall("sale", "sale")]), asOfDate: "2026-09-09", locale: "zh", user });
    expect(result).toEqual({ status: "permission_denied", callIds: ["sale"] });
    expect(executeWorkbenchQuery).not.toHaveBeenCalled();
  });

  it("executes independent authorized read calls through the existing service", async () => {
    vi.mocked(hasPermission).mockReturnValue(true);
    vi.mocked(executeWorkbenchQuery).mockImplementation(async (_query, intent) => ({ intent }) as never);
    const result = await executeQueryPlanV2({ query: "test", plan: plan([receivableCall("lease"), receivableCall("sale", "sale")]), asOfDate: "2026-09-09", locale: "zh", user });
    expect(result.status).toBe("success");
    expect(executeWorkbenchQuery).toHaveBeenCalledTimes(2);
  });
});
