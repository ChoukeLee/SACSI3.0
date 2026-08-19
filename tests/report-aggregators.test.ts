import { describe, it, expect } from "vitest";
import {
  aggregatePnlMonthly,
  aggregatePnlByBuilding,
  aggregateByCategory,
  monthRange,
} from "@/features/reports/report-aggregators";
import type { LedgerEntryRow, BuildingRow, UnitRow } from "@/types/database";

function entry(partial: Partial<LedgerEntryRow>): LedgerEntryRow {
  return {
    id: "e1",
    building_id: null,
    unit_id: null,
    payment_id: null,
    entry_date: "2026-08-10",
    direction: "income",
    category: "lease_rent",
    amount_xof: 100000,
    amount_cny: null,
    description: null,
    created_at: "2026-08-10T00:00:00Z",
    ...partial,
  };
}

describe("aggregatePnlMonthly", () => {
  it("sums income/expense per month and computes net", () => {
    const rows = [
      entry({ id: "a", entry_date: "2026-08-01", direction: "income", amount_xof: 500000 }),
      entry({ id: "b", entry_date: "2026-08-15", direction: "expense", amount_xof: 100000 }),
      entry({ id: "c", entry_date: "2026-07-10", direction: "income", amount_xof: 200000 }),
      entry({ id: "d", entry_date: "2026-08-20", direction: "liability_in", amount_xof: 999999 }),
    ];
    const r = aggregatePnlMonthly(rows, ["2026-07", "2026-08"]);
    expect(r.income).toEqual([200000, 500000]);
    expect(r.expense).toEqual([0, 100000]);
    expect(r.net).toEqual([200000, 400000]);
  });
});

describe("aggregatePnlByBuilding", () => {
  it("attributes entries to buildings via unit", () => {
    const buildings: BuildingRow[] = [
      { id: "b1", code: "SACSI11", display_name: "11#公寓" } as BuildingRow,
      { id: "b2", code: "SACSI5", display_name: "5#公寓" } as BuildingRow,
    ];
    const units: UnitRow[] = [
      { id: "u1", building_id: "b1" } as UnitRow,
      { id: "u2", building_id: "b2" } as UnitRow,
    ];
    const rows = [
      entry({ id: "a", unit_id: "u1", direction: "income", amount_xof: 100000 }),
      entry({ id: "b", unit_id: "u1", direction: "expense", amount_xof: 20000 }),
      entry({ id: "c", unit_id: "u2", direction: "income", amount_xof: 50000 }),
    ];
    const r = aggregatePnlByBuilding(rows, buildings, units);
    const b1 = r.find((x) => x.buildingId === "b1")!;
    expect(b1.income).toBe(100000);
    expect(b1.expense).toBe(20000);
    expect(b1.net).toBe(80000);
  });
});

describe("aggregateByCategory", () => {
  it("groups income by category, sorted desc", () => {
    const rows = [
      entry({ id: "a", direction: "income", category: "lease_rent", amount_xof: 100000 }),
      entry({ id: "b", direction: "income", category: "sale_contract", amount_xof: 300000 }),
      entry({ id: "c", direction: "income", category: "lease_rent", amount_xof: 50000 }),
      entry({ id: "d", direction: "expense", category: "lease_rent", amount_xof: 999 }),
    ];
    const r = aggregateByCategory(rows, "income");
    expect(r[0]).toEqual({ label: "sale_contract", value: 300000 });
    expect(r[1]).toEqual({ label: "lease_rent", value: 150000 });
  });
});

describe("monthRange", () => {
  it("generates ascending months", () => {
    expect(monthRange("2026-08", 3)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
  it("wraps across year", () => {
    expect(monthRange("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});
