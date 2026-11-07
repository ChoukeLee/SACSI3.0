import { expect, it } from "vitest";
import { parseAssetEntryImport, summarizeAssetEntryImport } from "./asset-operations-intake-model";

const row = {
  assetSourceKey: "old_warehouse:1",
  kind: "income",
  category: "rent",
  amountNative: 100.5,
  currency: "XOF",
  cashDate: "2026-10-09",
  sourceRef: "test.xlsx!H2",
  verification: "verified",
  recognitionMethod: "daily",
};
const term = {
  assetSourceKey: "old_warehouse:1",
  expectedUpdatedAt: "2026-11-07T00:00:00Z",
  monthlyRentNative: 500,
  rentCurrency: "XOF",
  reason: "Confirmed source unit",
};
const source = { projectId: "project", sourceFingerprint: "a".repeat(64) };

it("separates source cash totals from reference terms and never forwards a confirmed or allocation claim", () => {
  const parsed = parseAssetEntryImport(
    {
      ...source,
      entries: [
        row,
        {
          ...row,
          assetSourceKey: "new_warehouse:1",
          kind: "deposit_in",
          category: "deposit",
          amountNative: 20,
          currency: "CNY",
        },
      ],
      terms: [term],
    },
    "project",
  );
  expect(parsed.entries[0]).not.toHaveProperty("verification");
  expect(parsed.entries[0]).not.toHaveProperty("recognitionMethod");
  expect(summarizeAssetEntryImport(parsed)).toEqual({
    start: "2026-10-09",
    end: "2026-10-09",
    termCount: 1,
    totals: [
      { currency: "CNY", kind: "deposit_in", amount: 20, count: 1 },
      { currency: "XOF", kind: "income", amount: 100.5, count: 1 },
    ],
  });
});

it("accepts a terms-only update while requiring a version, amount precision and reason", () => {
  const parsed = parseAssetEntryImport({ ...source, terms: [term] }, "project");
  expect(parsed.entries).toEqual([]);
  expect(summarizeAssetEntryImport(parsed)).toMatchObject({
    start: null,
    end: null,
    totals: [],
    termCount: 1,
  });
  expect(() =>
    parseAssetEntryImport({ ...source, terms: [{ ...term, reason: "" }] }, "project"),
  ).toThrow();
  expect(() =>
    parseAssetEntryImport({ ...source, terms: [{ ...term, monthlyRentNative: 1.001 }] }, "project"),
  ).toThrow();
});

it("preserves a stable batch request ID and rejects malformed identifiers", () => {
  const requestId = "10000000-0000-4000-8000-000000000001";
  expect(parseAssetEntryImport({ ...source, requestId, entries: [row] }, "project").requestId).toBe(
    requestId,
  );
  expect(() =>
    parseAssetEntryImport({ ...source, requestId: "invalid", entries: [row] }, "project"),
  ).toThrow();
});

it("rejects cross-project, ambiguous date, canonical links and oversized intake", () => {
  expect(() => parseAssetEntryImport({ ...source, entries: [row] }, "different-project")).toThrow();
  expect(() =>
    parseAssetEntryImport({ ...source, entries: [{ ...row, cashDate: "2026-02-30" }] }, "project"),
  ).toThrow();
  expect(() =>
    parseAssetEntryImport({ ...source, entries: [{ ...row, paymentId: "legacy" }] }, "project"),
  ).toThrow();
  expect(() =>
    parseAssetEntryImport({ ...source, entries: Array(101).fill(row) }, "project"),
  ).toThrow();
});
