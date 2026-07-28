import { describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "../src/lib/supabase/fetch-all";
import { computeKpiData } from "../src/features/management/kpi-service";
import type { ReceivableRow } from "../src/types/database";

describe("finance reporting consistency", () => {
  it("fetches every page without duplicating boundary rows", async () => {
    const source = Array.from({ length: 2_005 }, (_, index) => index);
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: source.slice(from, to + 1),
      error: null,
    }));

    const rows = await fetchAllPages(fetchPage, "test rows", 1_000);

    expect(rows).toEqual(source);
    expect(fetchPage.mock.calls).toEqual([
      [0, 999],
      [1_000, 1_999],
      [2_000, 2_999],
    ]);
  });

  it("uses only the current due month for monthly KPI amounts", () => {
    const now = new Date();
    const currentDueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
    const oldDueDate = `${now.getFullYear() - 1}-01-15`;
    const row = (partial: Partial<ReceivableRow>): ReceivableRow => ({
      id: crypto.randomUUID(),
      building_id: null,
      unit_id: null,
      customer_id: null,
      source_type: "lease_contract",
      source_id: null,
      category: "lease_rent",
      title: "test",
      due_date: currentDueDate,
      amount_xof: 100,
      paid_amount_xof: 50,
      status: "partial",
      currency: "XOF",
      created_at: currentDueDate,
      updated_at: currentDueDate,
      ...partial,
    });

    const result = computeKpiData([
      row({ due_date: currentDueDate }),
      row({ due_date: oldDueDate, amount_xof: 500, paid_amount_xof: 500, status: "paid" }),
      row({ due_date: currentDueDate, amount_xof: 20, paid_amount_xof: 30, status: "paid" }),
    ], [], [], [], []);

    expect(result.totalReceivable).toBe(120);
    expect(result.totalPaid).toBe(70);
    expect(result.totalOutstanding).toBe(50);
    expect(result.collectionRate).toBe(58);
  });
});
