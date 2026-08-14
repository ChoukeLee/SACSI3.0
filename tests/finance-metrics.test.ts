import { describe, it, expect } from "vitest";
import {
  computeFinanceMetrics,
  isReceivableOverdue,
  receivableOutstanding,
} from "@/features/finance/metrics";
import type { ReceivableRow } from "@/types/database";

function rec(partial: Partial<ReceivableRow>): ReceivableRow {
  return {
    id: "r1",
    building_id: null,
    unit_id: null,
    customer_id: null,
    source_type: "lease_contract",
    source_id: null,
    category: "lease_rent",
    title: "租金",
    due_date: "2026-08-01",
    amount_xof: 100000,
    paid_amount_xof: 0,
    status: "pending",
    currency: "XOF",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

describe("computeFinanceMetrics", () => {
  it("computes receivable / collected / outstanding / overdue / rate", () => {
    const rows = [
      rec({ id: "a", amount_xof: 100000, paid_amount_xof: 100000, status: "paid", due_date: "2026-08-01" }),
      rec({ id: "b", amount_xof: 50000, paid_amount_xof: 10000, status: "partial", due_date: "2026-07-10" }),
      rec({ id: "c", amount_xof: 20000, paid_amount_xof: 0, status: "pending", due_date: "2026-09-01" }),
    ];
    const m = computeFinanceMetrics(rows, { asOfDate: "2026-08-14" });
    expect(m.receivable).toBe(170000);
    expect(m.collected).toBe(110000);
    expect(m.outstanding).toBe(60000);
    // overdue: only b (due 2026-07-10, unpaid 40000)
    expect(m.overdue).toBe(40000);
    expect(m.count).toBe(3);
    expect(m.collectionRate).toBeCloseTo(110000 / 170000);
  });

  it("excludes cancelled rows", () => {
    const rows = [
      rec({ id: "a", amount_xof: 100000, status: "cancelled" }),
      rec({ id: "b", amount_xof: 50000 }),
    ];
    const m = computeFinanceMetrics(rows);
    expect(m.count).toBe(1);
    expect(m.receivable).toBe(50000);
  });

  it("clamps outstanding to zero when overpaid", () => {
    const rows = [rec({ id: "a", amount_xof: 100000, paid_amount_xof: 150000, status: "paid" })];
    const m = computeFinanceMetrics(rows);
    expect(m.outstanding).toBe(0);
  });

  it("period scope filters by due_date month", () => {
    const rows = [
      rec({ id: "a", amount_xof: 100000, due_date: "2026-08-05" }),
      rec({ id: "b", amount_xof: 50000, due_date: "2026-07-28" }),
    ];
    const m = computeFinanceMetrics(rows, { scope: "period", period: "2026-08" });
    expect(m.count).toBe(1);
    expect(m.receivable).toBe(100000);
  });
});

describe("isReceivableOverdue", () => {
  it("due today is NOT overdue (strictly past due)", () => {
    expect(isReceivableOverdue(rec({ amount_xof: 100000, status: "pending", due_date: "2026-08-14" }), "2026-08-14")).toBe(false);
    expect(isReceivableOverdue(rec({ amount_xof: 100000, status: "pending", due_date: "2026-08-13" }), "2026-08-14")).toBe(true);
  });

  it("paid or cancelled is never overdue", () => {
    expect(isReceivableOverdue(rec({ amount_xof: 100000, paid_amount_xof: 100000, status: "paid", due_date: "2020-01-01" }), "2026-08-14")).toBe(false);
    expect(isReceivableOverdue(rec({ amount_xof: 100000, status: "cancelled", due_date: "2020-01-01" }), "2026-08-14")).toBe(false);
  });
});

describe("receivableOutstanding", () => {
  it("clamps to zero", () => {
    expect(receivableOutstanding(rec({ amount_xof: 100000, paid_amount_xof: 120000 }))).toBe(0);
    expect(receivableOutstanding(rec({ amount_xof: 100000, paid_amount_xof: 30000 }))).toBe(70000);
  });
});
