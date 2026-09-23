import { describe, expect, it } from "vitest";
import type { ReceivableRow } from "@/types/database";
import { countStartedLeasePeriods, resolveLeaseOverdue, summarizeLeaseReceivables } from "./lease-receivable-summary";

function receivable(overrides: Partial<ReceivableRow>): ReceivableRow {
  return {
    id: "receivable-id",
    building_id: "building-id",
    unit_id: "unit-id",
    customer_id: "customer-id",
    source_type: "lease_contract",
    source_id: "contract-id",
    category: "lease_rent",
    title: "Rent",
    due_date: "2026-07-01",
    amount_xof: 1_000_000,
    paid_amount_xof: 0,
    status: "pending",
    currency: "XOF",
    notes: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("summarizeLeaseReceivables", () => {
  it("counts only the overdue portion when future balances also exist", () => {
    const summary = summarizeLeaseReceivables([
      receivable({ id: "overdue", amount_xof: 1_000_000, paid_amount_xof: 300_000, due_date: "2026-06-01" }),
      receivable({ id: "future", amount_xof: 2_000_000, due_date: "2026-08-01" }),
    ], "2026-07-28");

    expect(summary.outstanding).toBe(2_700_000);
    expect(summary.overdue).toBe(700_000);
    expect(summary.earliestOverdueDue).toBe("2026-06-01");
  });

  it("excludes paid and cancelled receivables", () => {
    const summary = summarizeLeaseReceivables([
      receivable({ id: "paid", amount_xof: 500_000, paid_amount_xof: 500_000, status: "paid" }),
      receivable({ id: "cancelled", amount_xof: 900_000, status: "cancelled" }),
    ], "2026-07-28");

    expect(summary).toEqual({
      outstanding: 0,
      overdue: 0,
      earliestOutstandingDue: null,
      earliestOverdueDue: null,
    });
  });
});

describe("resolveLeaseOverdue", () => {
  it("uses the contract monthly rent when paid coverage expired without an open receivable", () => {
    expect(resolveLeaseOverdue({
      receivables: [],
      today: "2026-08-05",
      paidThroughDate: "2026-07-31",
      monthlyRentXof: 650_000,
    })).toEqual({
      dueDate: "2026-08-01",
      amount: 650_000,
      source: "contract",
      startedPeriods: 1,
    });
  });

  it("reconciles a materialized receivable without stopping later rent accrual", () => {
    expect(resolveLeaseOverdue({
      receivables: [receivable({ amount_xof: 950_000, due_date: "2026-07-01", status: "overdue" })],
      today: "2026-09-23",
      paidThroughDate: "2026-06-30",
      monthlyRentXof: 950_000,
    })).toEqual({
      dueDate: "2026-07-01",
      amount: 2_850_000,
      source: "contract",
      startedPeriods: 3,
    });
  });

  it("marks the first uncovered day overdue on its due date", () => {
    expect(resolveLeaseOverdue({
      receivables: [],
      today: "2026-08-01",
      paidThroughDate: "2026-07-31",
      monthlyRentXof: 650_000,
    })).toEqual({
      dueDate: "2026-08-01",
      amount: 650_000,
      source: "contract",
      startedPeriods: 1,
    });
  });

  it("subtracts a partial payment from the accrued period", () => {
    expect(resolveLeaseOverdue({
      receivables: [receivable({ amount_xof: 1_000_000, paid_amount_xof: 300_000, due_date: "2026-08-01" })],
      today: "2026-08-20",
      paidThroughDate: "2026-07-31",
      monthlyRentXof: 1_000_000,
    })).toEqual({
      dueDate: "2026-08-01",
      amount: 700_000,
      source: "receivable",
      startedPeriods: 1,
    });
  });

  it("caps accrual at the actual end date of a terminated contract", () => {
    expect(resolveLeaseOverdue({
      receivables: [],
      today: "2026-09-23",
      paidThroughDate: "2026-06-30",
      monthlyRentXof: 950_000,
      contractStatus: "terminated",
      actualEndDate: "2026-07-10",
    })).toEqual({
      dueDate: "2026-07-01",
      amount: 950_000,
      source: "contract",
      startedPeriods: 1,
    });
  });

  it("uses due receivables when paid-through coverage is missing", () => {
    expect(resolveLeaseOverdue({
      receivables: [receivable({ amount_xof: 800_000, paid_amount_xof: 200_000, due_date: "2026-09-23" })],
      today: "2026-09-23",
      paidThroughDate: null,
      monthlyRentXof: 800_000,
    })).toEqual({
      dueDate: "2026-09-23",
      amount: 600_000,
      source: "receivable",
      startedPeriods: 0,
    });
  });

  it("does not count an unpaid receivable as overdue until after its due date", () => {
    const summary = summarizeLeaseReceivables([
      receivable({ amount_xof: 650_000, due_date: "2026-08-10", status: "pending" }),
    ], "2026-08-10");

    expect(summary.overdue).toBe(0);
    expect(summary.earliestOverdueDue).toBeNull();
  });
});

describe("countStartedLeasePeriods", () => {
  it("counts each started calendar-anchored period and rounds the current period up", () => {
    expect(countStartedLeasePeriods("2026-07-01", "2026-09-08")).toBe(3);
    expect(countStartedLeasePeriods("2026-07-17", "2026-09-16")).toBe(2);
    expect(countStartedLeasePeriods("2026-07-17", "2026-09-17")).toBe(3);
  });

  it("clamps month-end anchors without drifting", () => {
    expect(countStartedLeasePeriods("2026-01-31", "2026-02-27")).toBe(1);
    expect(countStartedLeasePeriods("2026-01-31", "2026-02-28")).toBe(2);
    expect(countStartedLeasePeriods("2026-01-31", "2026-03-30")).toBe(2);
    expect(countStartedLeasePeriods("2026-01-31", "2026-03-31")).toBe(3);
  });
});
