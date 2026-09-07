import { describe, expect, it } from "vitest";
import { enrichQueryWithConversationContext } from "./conversation-context";

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
});
