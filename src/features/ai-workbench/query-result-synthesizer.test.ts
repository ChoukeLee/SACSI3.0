import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildQueryResultSynthesisPacket, synthesizeQueryPlanResult, validateSynthesizedAnswer } from "./query-result-synthesizer";
import type { WorkbenchResult } from "./types";

function result(): WorkbenchResult {
  return {
    kind: "query_result",
    query: "客户 Secret Person 的11号楼503合同",
    intent: { kind: "receivable_outstanding", domain: "lease", buildingCode: "SACSI11", unitNo: "503", customerName: "Secret Person", days: 15, asOfDate: "2026-09-09", confidence: 0.9, source: "deepseek" },
    title: "长租当前未收",
    answer: "Secret Person 当前还有一笔款项。",
    scope: "长租 · 11# · 客户 Secret Person",
    metrics: [{ label: "未收合计", value: "150,000 XOF", tone: "amber" }],
    table: { columns: [{ key: "customer", label: "客户" }, { key: "contract", label: "合同" }], rows: [{ customer: "Secret Person", contract: "LEASE-PRIVATE-1" }] },
    evidence: [{ label: "财务口径", value: "仅统计未取消且余额大于 0 的应收" }],
    warnings: [],
    generatedAt: "2026-09-09T10:00:00.000Z",
    resultCount: 1,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("query result synthesizer", () => {
  it("builds a minimized packet without query, scope, answer or table rows", () => {
    const packetText = JSON.stringify(buildQueryResultSynthesisPacket("zh", "list_receivables", result()));
    expect(packetText).toContain("150,000 XOF");
    expect(packetText).not.toContain("Secret Person");
    expect(packetText).not.toContain("LEASE-PRIVATE-1");
  });

  it("rejects prose that introduces a numeric fact absent from the packet", () => {
    const packet = buildQueryResultSynthesisPacket("zh", "list_receivables", result());
    expect(validateSynthesizedAnswer("目前未收合计为 150,000 XOF。", packet)).toBe("目前未收合计为 150,000 XOF。");
    expect(validateSynthesizedAnswer("目前有 9 笔，未收合计为 150,000 XOF。", packet)).toBeNull();
  });

  it("is inert unless explicitly enabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const original = result();
    await expect(synthesizeQueryPlanResult({ locale: "zh", tool: "list_receivables", result: original })).resolves.toBe(original);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses valid constrained prose and falls back on invented numbers", async () => {
    vi.stubEnv("AI_QUERY_RESULT_SYNTHESIS_ENABLED", "true");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "目前未收合计为 150,000 XOF。" }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "目前有 9 笔未收款。" }) } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const original = result();
    await expect(synthesizeQueryPlanResult({ locale: "zh", tool: "list_receivables", result: original }))
      .resolves.toMatchObject({ answer: "目前未收合计为 150,000 XOF。" });
    await expect(synthesizeQueryPlanResult({ locale: "zh", tool: "list_receivables", result: original }))
      .resolves.toBe(original);
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(requestBody.messages[1].content).not.toContain("Secret Person");
  });
});
