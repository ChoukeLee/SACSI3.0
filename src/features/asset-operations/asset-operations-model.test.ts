import { describe, expect, it } from "vitest";
import {
  allocateAssetPeriodAmount,
  assetOperationsCsv,
  assetReportPeriod,
  buildAssetOperationsReport,
  type AssetOperationAsset,
  type AssetOperationEntry,
  assetSourceLabel,
} from "./asset-operations-model";

const asset: AssetOperationAsset = {
  id: "old-1",
  projectId: "project",
  unitId: null,
  code: "OLD-1",
  name: "1",
  group: "old_warehouse",
  verification: "verified",
  sourceRefs: ["source.xlsx!A2:I2"],
  monthlyRentNative: 375000,
  rentCurrency: "XOF",
  costCoverageThrough: null,
  updatedAt: "2026-11-07T00:00:00Z",
};
const entry: AssetOperationEntry = {
  id: "rent-1",
  assetId: asset.id,
  kind: "income",
  amountNative: 6000000,
  currency: "XOF",
  cashDate: "2026-09-28",
  periodStart: "2026-10-01",
  periodEnd: "2027-03-31",
  recognitionMethod: "daily",
  verification: "verified",
  sourceRef: "receipt-1",
  description: "Six months prepaid",
};

describe("asset report periods", () => {
  it("uses Monday to Sunday across a year boundary and accepts leap February", () => {
    expect(assetReportPeriod("week", "2027-01-01")).toMatchObject({
      start: "2026-12-28",
      end: "2027-01-03",
    });
    expect(assetReportPeriod("month", "2028-02").end).toBe("2028-02-29");
    expect(() => assetReportPeriod("custom", "2026-02-30", "2026-03-01")).toThrow();
    expect(() => assetReportPeriod("custom", "2026-11-10", "2026-11-01")).toThrow();
  });
});

describe("warehouse cash and period reporting", () => {
  it("keeps prepaid cash in its actual month and allocates only the overlapping service days", () => {
    const september = buildAssetOperationsReport(
      [asset],
      [entry],
      assetReportPeriod("month", "2026-09"),
    );
    const october = buildAssetOperationsReport(
      [asset],
      [entry],
      assetReportPeriod("month", "2026-10"),
    );
    expect(september.currencies[0]).toMatchObject({ cashIncome: 6000000, periodIncome: 0 });
    expect(october.currencies[0]).toMatchObject({ cashIncome: 0, periodIncome: 1021978.02 });
  });

  it("conserves every minor unit when adjacent service reports partition a payment", () => {
    const values = Array.from({ length: 31 }, (_, index) => {
      const day = `2026-01-${String(index + 1).padStart(2, "0")}`;
      return allocateAssetPeriodAmount(10.01, "CNY", "2026-01-01", "2026-01-31", day, day);
    });
    expect(Math.round(values.reduce((sum, value) => sum + value, 0) * 100)).toBe(1001);
    expect(
      allocateAssetPeriodAmount(100, "XOF", "2026-01-01", "2026-01-31", "2026-02-01", "2026-02-28"),
    ).toBe(0);
  });

  it("does not treat source pending facts or unverified assets as confirmed cash", () => {
    const pendingEntry = { ...entry, id: "pending", verification: "pending" as const };
    const report = buildAssetOperationsReport(
      [asset],
      [pendingEntry],
      assetReportPeriod("month", "2026-09"),
    );
    expect(report.currencies).toEqual([]);
    expect(report.pendingEntryCount).toBe(1);
    expect(report.pendingCurrencies).toEqual([
      { currency: "XOF", income: 6000000, expense: 0, depositIn: 0, depositOut: 0, entryCount: 1 },
    ]);
    const pendingAsset = buildAssetOperationsReport(
      [{ ...asset, verification: "pending" }],
      [entry],
      assetReportPeriod("month", "2026-09"),
    );
    expect(pendingAsset.currencies).toEqual([]);
  });

  it("keeps pending source totals separated by currency and excludes voided or out-of-period cash", () => {
    const facts: AssetOperationEntry[] = [
      { ...entry, id: "cny", currency: "CNY", amountNative: 100, verification: "pending" },
      {
        ...entry,
        id: "deposit",
        kind: "deposit_in",
        currency: "XOF",
        amountNative: 500,
        verification: "pending",
      },
      {
        ...entry,
        id: "voided",
        amountNative: 900,
        verification: "pending",
        voidedAt: "2026-11-07T00:00:00Z",
      },
      {
        ...entry,
        id: "future",
        amountNative: 800,
        cashDate: "2026-12-01",
        verification: "pending",
      },
    ];
    const report = buildAssetOperationsReport(
      [asset],
      facts,
      assetReportPeriod("month", "2026-09"),
    );
    expect(report.currencies).toEqual([]);
    expect(report.pendingCurrencies).toEqual([
      { currency: "XOF", income: 0, expense: 0, depositIn: 500, depositOut: 0, entryCount: 1 },
      { currency: "CNY", income: 100, expense: 0, depositIn: 0, depositOut: 0, entryCount: 1 },
    ]);
  });

  it("uses the source file, sheet and range as its readable label", () => {
    expect(
      assetSourceLabel(`sha256:${"a".repeat(64)}|file:test.xlsx|sheet:old warehouses|range:H2:J2`),
    ).toBe("test.xlsx · old warehouses!H2:J2");
    expect(assetSourceLabel("receipt-line-1")).toBe("receipt-line-1");
  });

  it("separates deposits and currencies, excludes duplicate IDs, and flags absent service allocation", () => {
    const deposit = { ...entry, id: "deposit", kind: "deposit_in" as const, amountNative: 1200000 };
    const expense = {
      ...entry,
      id: "cost",
      kind: "expense" as const,
      amountNative: 100,
      currency: "USD" as const,
      periodStart: null,
      periodEnd: null,
    };
    const report = buildAssetOperationsReport(
      [asset],
      [entry, entry, deposit, expense],
      assetReportPeriod("month", "2026-09"),
    );
    expect(report.currencies[0]).toMatchObject({
      currency: "XOF",
      cashIncome: 6000000,
      depositIn: 1200000,
      cashNet: 6000000,
    });
    expect(report.currencies[1]).toMatchObject({
      currency: "USD",
      cashExpense: 100,
      cashNet: -100,
    });
    expect(report.unallocatedServiceCount).toBe(1);
    expect(report.exclusions).toContainEqual({ entryId: entry.id, reason: "DuplicateEntryId" });
  });

  it("surfaces invalid dates and money rather than silently reporting a healthy zero", () => {
    const report = buildAssetOperationsReport(
      [asset],
      [
        { ...entry, cashDate: "2026-09-31" },
        { ...entry, id: "fraction", amountNative: 0.001 },
      ],
      assetReportPeriod("month", "2026-09"),
    );
    expect(report.currencies).toEqual([]);
    expect(report.exclusions).toHaveLength(2);
  });

  it("does not manufacture cash or earned income from theoretical rental standards", () => {
    const report = buildAssetOperationsReport([asset], [], assetReportPeriod("month", "2026-11"));
    expect(report.currencies).toEqual([]);
    expect(report.entries).toEqual([]);
  });

  it("requires an explicit allocation method even when dates and amount are verified", () => {
    const report = buildAssetOperationsReport(
      [asset],
      [{ ...entry, recognitionMethod: "unallocated" }],
      assetReportPeriod("month", "2026-10"),
    );
    expect(report.currencies[0]).toMatchObject({ periodIncome: 0, serviceFactCount: 0 });
    expect(report.unallocatedServiceCount).toBe(1);
  });

  it("preserves fractional XOF instead of dropping a valid historical amount", () => {
    const report = buildAssetOperationsReport(
      [asset],
      [{ ...entry, amountNative: 100.5 }],
      assetReportPeriod("month", "2026-09"),
    );
    expect(report.currencies[0].cashIncome).toBe(100.5);
  });

  it("retains a voided receipt in history while excluding its cash and allocation", () => {
    const voided = {
      ...entry,
      voidedAt: "2026-11-07T12:00:00Z",
      voidReason: "Duplicate source receipt",
    };
    const report = buildAssetOperationsReport(
      [asset],
      [voided],
      assetReportPeriod("month", "2026-10"),
    );
    expect(report.currencies).toEqual([]);
    expect(report.entries).toEqual([voided]);
    expect(report.voidedEntryCount).toBe(1);
    expect(report.exclusions).toContainEqual({ entryId: entry.id, reason: "VoidedEntry" });
  });

  it("keeps unknown-date records visible for reconciliation and protects CSV source text", () => {
    const report = buildAssetOperationsReport(
      [asset],
      [{ ...entry, cashDate: null, periodStart: null, periodEnd: null }],
      assetReportPeriod("month", "2026-11"),
    );
    expect(report.undatedEntryCount).toBe(1);
    expect(assetOperationsCsv(["source"], [['=HYPERLINK("bad")']])).toContain("'=HYPERLINK");
  });
});
