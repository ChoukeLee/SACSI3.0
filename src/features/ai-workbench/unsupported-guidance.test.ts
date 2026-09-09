import { describe, expect, it } from "vitest";
import { buildUnsupportedGuidance } from "./unsupported-guidance";
import type { WorkbenchIntent } from "./types";

const baseIntent: WorkbenchIntent = {
  kind: "unsupported",
  domain: "all",
  buildingCode: null,
  unitNo: null,
  customerName: null,
  days: 15,
  asOfDate: "2026-09-09",
  confidence: 0.2,
  source: "rules",
};

describe("unsupported query guidance", () => {
  it("asks a targeted question when the building is known", () => {
    const guidance = buildUnsupportedGuidance({ ...baseIntent, buildingCode: "SACSI11" }, "zh");
    expect(guidance.answer).toContain("楼栋 11#");
    expect(guidance.answer).toContain("日租、长租还是出售");
    expect(guidance.suggestions).toContain("11#今天日租房态");
  });

  it("offers domain-specific choices for a partial lease request", () => {
    const guidance = buildUnsupportedGuidance({ ...baseIntent, domain: "lease", buildingCode: "SACSI11" }, "zh");
    expect(guidance.answer).toContain("逾期、未收、近期到期");
    expect(guidance.suggestions).toContain("11#长租逾期明细");
  });

  it("returns equivalent targeted guidance in French", () => {
    const guidance = buildUnsupportedGuidance({ ...baseIntent, domain: "daily", buildingCode: "SACSI5" }, "fr");
    expect(guidance.answer).toContain("bâtiment 5#");
    expect(guidance.answer).toContain("arrivées ou les départs");
  });
});
