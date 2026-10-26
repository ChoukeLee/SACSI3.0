import { describe, expect, it } from "vitest";
import { decodeOperatingSnapshot } from "@/features/management/operating-snapshot";
import { operatingSnapshotFixture } from "./fixtures/operating-snapshot";
describe("operating snapshot boundary", () => {
  it("decodes an exact project snapshot including true zero receipt months", () => {
    const data = operatingSnapshotFixture();
    expect(decodeOperatingSnapshot(data)).toEqual(data);
    expect(decodeOperatingSnapshot(data).trend[0].count).toBe(0);
  });
  it.each([
    null,
    [],
    {},
    { ...operatingSnapshotFixture(), netCollected: undefined },
    { ...operatingSnapshotFixture(), dueOutstanding: -1 },
    { ...operatingSnapshotFixture(), asOf: "2026-02-30" },
    { ...operatingSnapshotFixture(), trend: [] },
  ])("rejects unavailable or corrupt amounts instead of showing successful zeros (%j)", (data) => {
    expect(() => decodeOperatingSnapshot(data)).toThrow("OperatingSnapshotUnavailable");
  });
  it("requires receipt count in every trend bucket so missing history never looks like zero business", () => {
    const data = operatingSnapshotFixture();
    const missingCount = { ...data, trend: data.trend.map(({ count: _count, ...row }) => row) };
    expect(() => decodeOperatingSnapshot(missingCount)).toThrow("OperatingSnapshotUnavailable");
  });
  it("accepts the separate future lease count while retaining compatibility with older snapshots", () => {
    const base = operatingSnapshotFixture();
    expect(decodeOperatingSnapshot(base).pendingLeaseCount).toBeUndefined();
    expect(decodeOperatingSnapshot({ ...base, pendingLeaseCount: 3 }).pendingLeaseCount).toBe(3);
    for (const pendingLeaseCount of [-1, 1.5, null, "NaN"]) {
      expect(() => decodeOperatingSnapshot({ ...base, pendingLeaseCount })).toThrow();
    }
  });
});
