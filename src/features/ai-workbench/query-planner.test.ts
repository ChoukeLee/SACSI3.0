import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { planWorkbenchQueryV2 } from "./query-planner";

const validPlan = {
  version: 2,
  objective: "Review month-end lease receivables",
  needsClarification: false,
  clarificationQuestion: null,
  calls: [{
    id: "rent",
    tool: "list_receivables",
    arguments: {
      domain: "lease",
      buildingCode: "SACSI11",
      unitNo: null,
      customerName: null,
      time: { kind: "end_of_current_month", value: null, startDate: null, endDate: null },
      receivableState: "due_in_window",
      metrics: ["list", "amount_outstanding"],
      limit: 100,
    },
  }],
  confidence: 0.94,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("query planner v2 model boundary", () => {
  it("is inert unless shadow mode is explicitly enabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(planWorkbenchQueryV2({ query: "月底长租应收", asOfDate: "2026-09-09", locale: "zh", history: [] })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends date, timezone and minimized history and accepts a strict plan", async () => {
    vi.stubEnv("AI_QUERY_PLANNER_SHADOW_ENABLED", "true");
    vi.stubEnv("AI_QUERY_PLANNER_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("AI_QUERY_PLANNER_THINKING_ENABLED", "true");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validPlan) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const plan = await planWorkbenchQueryV2({
      query: "那11号楼月底前还没交的呢？",
      asOfDate: "2026-09-09",
      locale: "zh",
      history: [{
        userText: "查看11号楼长租",
        context: { buildingCode: "SACSI11", domain: "lease", ignoredSecret: "never-send" },
      }],
    });
    expect(plan).toMatchObject({ version: 2, provider: "deepseek", calls: [{ tool: "list_receivables" }] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.messages[0].content).toContain("Reference date: 2026-09-09");
    expect(body.messages[0].content).toContain("Timezone: Africa/Abidjan");
    const userInput = JSON.parse(body.messages[1].content);
    expect(userInput).toMatchObject({
      currentUserMessage: "那11号楼月底前还没交的呢？",
      recentConversation: [{ priorUserMessage: "查看11号楼长租", priorBusinessContext: { buildingCode: "SACSI11", domain: "lease" } }],
    });
    expect(body.messages[1].content).not.toContain("never-send");
  });

  it("rejects malformed model output", async () => {
    vi.stubEnv("AI_QUERY_PLANNER_SHADOW_ENABLED", "true");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ ...validPlan, calls: [{ id: "sql", tool: "run_sql", arguments: validPlan.calls[0].arguments }] }) } }],
    }), { status: 200 })));
    await expect(planWorkbenchQueryV2({ query: "run it", asOfDate: "2026-09-09", locale: "zh", history: [] })).resolves.toBeNull();
  });
});
