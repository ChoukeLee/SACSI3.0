import { describe, expect, it } from "vitest";
import { enrichQueryWithConversationContext, selectConversationContext } from "./conversation-context";
import { parseWorkbenchIntent } from "./intent-parser";

describe("AI conversation context", () => {
  it("adds the previous unit and domain to a contextual follow-up", () => {
    expect(enrichQueryWithConversationContext("那这个房间欠多少？", {
      buildingCode: "SACSI11",
      unitNo: "503",
      domain: "lease",
    })).toContain("11#，房号 503，长租");
  });

  it("does not alter a self-contained new request", () => {
    expect(enrichQueryWithConversationContext("查看12#502的合同", {
      buildingCode: "SACSI11",
      unitNo: "503",
      domain: "lease",
    })).toBe("查看12#502的合同");
  });

  it("understands a short elliptical follow-up without a leading pronoun", () => {
    const enriched = enrichQueryWithConversationContext("欠多少？", {
      buildingCode: "SACSI11",
      unitNo: "503",
      domain: "lease",
    });
    expect(enriched).toContain("11#，房号 503，长租");
    expect(parseWorkbenchIntent(enriched, "2026-09-09")).toMatchObject({
      kind: "receivable_outstanding",
      buildingCode: "SACSI11",
      unitNo: "503",
      domain: "lease",
    });
  });

  it("does not narrow an explicit list request to the previous room", () => {
    expect(enrichQueryWithConversationContext("还有哪些长租逾期？", {
      buildingCode: "SACSI11",
      unitNo: "503",
      domain: "lease",
    })).toBe("还有哪些长租逾期？");
  });

  it("supports a French elliptical follow-up", () => {
    const enriched = enrichQueryWithConversationContext("Combien reste à payer ?", {
      buildingCode: "SACSI11",
      unitNo: "503",
      domain: "lease",
    });
    expect(enriched).toContain("11#，房号 503，长租");
    expect(parseWorkbenchIntent(enriched, "2026-09-09")).toMatchObject({
      kind: "receivable_outstanding",
      buildingCode: "SACSI11",
      unitNo: "503",
      domain: "lease",
    });
  });

  it.each(["然后呢？", "接着呢？", "这笔呢？", "刚才那个房间怎么样？"])("carries the recent object into a conversational continuation: %s", (query) => {
    const enriched = enrichQueryWithConversationContext(query, {
      buildingCode: "SACSI11",
      unitNo: "1001",
      domain: "daily",
    });
    expect(enriched).toContain("11#，房号 1001，日租");
    expect(parseWorkbenchIntent(enriched, "2026-09-09")).toMatchObject({
      kind: "unit_snapshot",
      buildingCode: "SACSI11",
      unitNo: "1001",
      domain: "daily",
    });
  });

  it("supports a French conversational continuation", () => {
    const enriched = enrichQueryWithConversationContext("Et ensuite ?", {
      buildingCode: "SACSI11",
      unitNo: "503",
      domain: "lease",
    });
    expect(enriched).toContain("11#，房号 503，长租");
    expect(parseWorkbenchIntent(enriched, "2026-09-09")).toMatchObject({
      kind: "unit_snapshot",
      buildingCode: "SACSI11",
      unitNo: "503",
      domain: "lease",
    });
  });

  it("skips empty turns and selects the nearest meaningful context", () => {
    expect(selectConversationContext([
      { buildingCode: "SACSI11", unitNo: "503", domain: "lease" },
      { buildingCode: null, unitNo: null, domain: "all" },
    ])).toMatchObject({ buildingCode: "SACSI11", unitNo: "503", domain: "lease" });
  });

  it("treats a newer domain-only turn as a topic boundary", () => {
    expect(selectConversationContext([
      { buildingCode: "SACSI11", unitNo: "503", domain: "lease" },
      { buildingCode: null, unitNo: null, domain: "sale" },
    ])).toEqual({ buildingCode: null, unitNo: null, domain: "sale" });
  });
});
