import { describe, expect, it } from "vitest";
import {
  businessDate,
  composeReceiptAnalysis,
  defaultReceiptMonth,
  parseReceiptQuery,
  receiptComparison,
  receiptCsv,
} from "@/features/daily-rentals/receipt-analysis-query";
import type {
  ReceiptAnalysis,
  ReceiptSummary,
} from "@/features/daily-rentals/receipt-analysis-types";

const now = new Date("2026-10-15T18:00:00Z");
const summary = (net = 100, excludedCount = 0): ReceiptSummary => ({
  gross: Math.max(net, 0),
  refund: Math.max(-net, 0),
  adjustment: 0,
  net,
  count: 1,
  excludedCount,
});
describe("receipt query dates and scope", () => {
  it("uses Abidjan date and defaults to last completed month", () => {
    expect(businessDate(new Date("2026-10-15T23:59:00Z"))).toBe("2026-10-15");
    expect(defaultReceiptMonth(now)).toBe("2026-09");
    const q = parseReceiptQuery({}, now);
    expect(q.periods).toMatchObject({
      current: { from: "2026-09-01", to: "2026-09-30" },
      previous: { from: "2026-08-01", to: "2026-08-31" },
      year: { from: "2025-09-01", to: "2025-09-30" },
      trend: { from: "2025-10-01", to: "2026-09-30" },
      partial: false,
    });
  });
  it("compares current month only through yesterday against same calendar days", () => {
    expect(parseReceiptQuery({ month: "2026-10" }, now).periods).toMatchObject({
      current: { from: "2026-10-01", to: "2026-10-14" },
      previous: { from: "2026-09-01", to: "2026-09-14" },
      year: { from: "2025-10-01", to: "2025-10-14" },
      partial: true,
    });
  });
  it("handles year boundaries and leap February without rolled dates", () => {
    expect(defaultReceiptMonth(new Date("2026-01-01T00:00Z"))).toBe("2025-12");
    expect(parseReceiptQuery({ month: "2024-02" }, now).periods.year).toEqual({
      from: "2023-02-01",
      to: "2023-02-28",
    });
    expect(parseReceiptQuery({ month: "2024-02" }, now).periods.current.to).toBe("2024-02-29");
  });
  it("rejects currentmonth on first day rather than a range ending before it begins", () => {
    expect(() => parseReceiptQuery({ month: "2026-10" }, new Date("2026-10-01T12:00Z"))).toThrow(
      "currentMonthHasNoCompleteDay",
    );
  });
  it("custom periods compare preceding equal duration and identify them as custom", () => {
    const q = parseReceiptQuery({ dateFrom: "2026-10-03", dateTo: "2026-10-09" }, now);
    expect(q.filters.month).toBe("");
    expect(q.periods.previous).toEqual({ from: "2026-09-26", to: "2026-10-02" });
    expect(q.periods.custom).toBe(true);
  });
  it.each([
    { month: "2026-13" },
    { month: "2026-11" },
    { month: "99-1" },
    { month: "1900-01" },
    { dateFrom: "2026-09-01" },
    { dateFrom: "2026-02-30", dateTo: "2026-03-01" },
    { dateFrom: "2026-10-16", dateTo: "2026-10-18" },
    { dateFrom: "2026-09-10", dateTo: "2026-09-01" },
    { dateFrom: "2024-01-01", dateTo: "2026-01-01" },
    { buildingId: "not-uuid" },
    { query: "x".repeat(121) },
    { method: "card" },
    { kind: "income" },
    { page: "0" },
    { page: "1.0" },
    { page: "1e2" },
    { page: "2000001" },
    { export: "true" },
    { locale: "en" },
    { month: ["2026-09", "2026-08"] },
  ])("rejects malformed or unbounded filters %j", (params) => {
    expect(() => parseReceiptQuery(params, now)).toThrow("invalidReceiptFilter");
  });
  it("normalizes building and literal search without treating user text as code", () => {
    const q = parseReceiptQuery(
      { buildingId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", query: " %_'  " },
      now,
    );
    expect(q.input.buildingId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(q.input.query).toBe("%_'");
  });
});
describe("honest receipt comparisons", () => {
  const period = { from: "2026-08-01", to: "2026-08-31" };
  const coverage = { firstDate: "2025-01-01", lastDate: "2026-10-15" };
  it("returns growth amount and rate for positive comparable baseline", () => {
    expect(receiptComparison(summary(120), summary(100), period, coverage)).toMatchObject({
      status: "available",
      amount: 20,
      percent: 20,
    });
  });
  it("does not fabricate zero or missing historical baseline", () => {
    expect(
      receiptComparison({ ...summary(0), count: 0 }, summary(100), period, coverage).status,
    ).toBe("insufficient_history");
    expect(receiptComparison(summary(), { ...summary(0), count: 0 }, period, coverage).status).toBe(
      "insufficient_history",
    );
    expect(receiptComparison(summary(), summary(0), period, coverage)).toMatchObject({
      status: "non_positive_baseline",
      percent: null,
    });
    expect(receiptComparison(summary(), summary(-10), period, coverage).status).toBe(
      "non_positive_baseline",
    );
    expect(
      receiptComparison(summary(), summary(), period, {
        firstDate: "2026-08-12",
        lastDate: "2026-09-30",
      }).status,
    ).toBe("insufficient_history");
  });
  it("blocks rates for excluded records or unequal elapsed days", () => {
    expect(receiptComparison(summary(120, 1), summary(), period, coverage).status).toBe(
      "excluded_records",
    );
    expect(receiptComparison(summary(), summary(), period, coverage, true).status).toBe(
      "unequal_period",
    );
  });
  it("full months may have different lengths; partial short February is explicit", () => {
    const result = { summary: summary(120), previous: summary(), year: summary(), coverage };
    expect(
      composeReceiptAnalysis(result as never, parseReceiptQuery({ month: "2026-03" }, now))
        .comparisons.previous.status,
    ).toBe("available");
    const q = parseReceiptQuery({ month: "2026-03" }, new Date("2026-03-31T10:00Z"));
    expect(q.periods.previous.to).toBe("2026-02-28");
    expect(composeReceiptAnalysis(result as never, q).comparisons.previous.status).toBe(
      "unequal_period",
    );
  });
});
it("CSV is BOM UTF8, keeps numeric negatives and guards spreadsheet formulas", () => {
  const row = {
    date: "2026-09-01",
    buildingName: "=cmd",
    room: "\t+cmd",
    guestName: "@cmd",
    bookingAgentName: "-cmd",
    kind: "refund",
    paymentMethod: null,
    receiptNo: 'A,"B',
    amount: -100,
    currency: "XOF",
    amountXof: -100,
    exclusionReason: null,
    createdAt: "2026-09-01T00:00Z",
    bookingId: null,
    reversalOf: null,
    notes: "\u0001=cmd",
    id: "id",
  };
  const csv = receiptCsv({ rows: [row] } as unknown as ReceiptAnalysis);
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv).toContain('"\'=cmd"');
  expect(csv).toContain('"\'\t+cmd"');
  expect(csv).toContain('"-100"');
  expect(csv).toContain('"A,""B"');
  expect(csv).toContain("\r\n");
  expect(
    receiptCsv(
      {
        rows: [{ ...row, amount: null, amountXof: null, kind: "excluded" }],
      } as unknown as ReceiptAnalysis,
      "fr",
    ),
  ).toContain("Motif exclusion");
});
