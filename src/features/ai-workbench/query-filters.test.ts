import { describe, expect, it } from "vitest";
import { dateIsWithinRange, matchesCustomerName, queryRangeLabel } from "./query-filters";
import type { ResolvedTimeRange } from "./query-plan";

const range: ResolvedTimeRange = {
  startDate: "2026-09-09",
  endDate: "2026-09-30",
  startInclusive: false,
  endInclusive: true,
  timezone: "Africa/Abidjan",
};

describe("query tool filters", () => {
  it("honors open and closed date boundaries", () => {
    expect(dateIsWithinRange("2026-09-09", range)).toBe(false);
    expect(dateIsWithinRange("2026-09-10", range)).toBe(true);
    expect(dateIsWithinRange("2026-09-30", range)).toBe(true);
    expect(dateIsWithinRange("2026-10-01", range)).toBe(false);
  });

  it("matches customer names case-, accent- and whitespace-insensitively", () => {
    expect(matchesCustomerName("  Jérôme   Koné ", "jerome kone")).toBe(true);
    expect(matchesCustomerName("Entreprise Kouassi", "kouassi")).toBe(true);
    expect(matchesCustomerName("Entreprise Kouassi", "Yao")).toBe(false);
  });

  it("renders exact boundary semantics", () => {
    expect(queryRangeLabel(range)).toBe("2026-09-09（不含）至 2026-09-30（含）");
    expect(queryRangeLabel(range, "fr")).toBe("du 2026-09-09 exclu au 2026-09-30 inclus");
  });
});
