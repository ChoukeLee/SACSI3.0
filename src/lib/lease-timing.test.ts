import { describe, expect, it } from "vitest";
import { isCurrentLease, isFutureLease, leaseStatusLabel } from "./lease-timing";

describe("lease timing on the business date", () => {
  const active = { status: "active", start_date: "2026-11-15" };

  it("switches a future active agreement to current on its actual start date", () => {
    expect(isFutureLease(active, "2026-11-14")).toBe(true);
    expect(isCurrentLease(active, "2026-11-14")).toBe(false);
    expect(isFutureLease(active, "2026-11-15")).toBe(false);
    expect(isCurrentLease(active, "2026-11-15")).toBe(true);
  });

  it("requires both a confirmed start and the active lifecycle status", () => {
    for (const status of ["draft", "terminated", "expired"]) {
      expect(isFutureLease({ ...active, status }, "2026-10-26")).toBe(false);
      expect(isCurrentLease({ ...active, status }, "2026-11-16")).toBe(false);
    }
    expect(isCurrentLease({ status: "active", start_date: null }, "2026-10-26")).toBe(false);
    expect(isFutureLease({ status: "active" }, "2026-10-26")).toBe(false);
  });

  it("keeps an already started active lease current after its recorded end date", () => {
    const placeholder = { ...active, expected_end_date: "2026-11-30" };
    expect(isCurrentLease(placeholder, "2026-12-16")).toBe(true);
  });

  it("localizes only the derived future state and preserves other status labels", () => {
    expect(leaseStatusLabel(active, "2026-10-26", "zh", "生效中")).toBe("待起租");
    expect(leaseStatusLabel(active, "2026-10-26", "fr", "Actif")).toBe("À venir");
    expect(leaseStatusLabel(active, "2026-11-15", "zh", "生效中")).toBe("生效中");
    expect(leaseStatusLabel({ ...active, status: "draft" }, "2026-10-26", "fr", "Brouillon")).toBe(
      "Brouillon",
    );
  });
});
