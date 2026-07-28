import { describe, expect, it } from "vitest";
import type { ReceivableRow } from "@/types/database";
import { summarizeLeaseReceivables } from "./lease-receivable-summary";

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
