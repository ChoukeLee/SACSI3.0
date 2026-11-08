import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readUnitBusinessSummaries } from "@/features/units/unit-business-summary-read";
import type {
  UnitWorkbenchBuilding,
  UnitWorkbenchRecord,
} from "@/features/units/unit-workbench-model";
import type { UnitRow } from "@/types/database";

type Row = { id: string } & Record<string, unknown>;
type Call = { table: string; filters: [string, readonly unknown[]][]; from: number; to: number };
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const building: UnitWorkbenchBuilding = {
  id: id(1),
  code: "SACSI7",
  display_name: "Synthetic building",
  project_id: id(2),
  project_code: "SACSI",
  project_name: "Synthetic",
  allows_sale: true,
};
const asset = (n = 1, buildingId = building.id): UnitWorkbenchRecord => ({
  unit: {
    id: id(100 + n),
    building_id: buildingId,
    unit_no: String(100 + n),
    floor_label: "1F",
    code: `SYNTHETIC-${n}`,
    kind: "apartment",
    status: "available",
    area_sqm: null,
    layout: null,
    furnishing: null,
    notes: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  } as UnitRow,
  position: null,
  flags: [],
});
const contract = (n = 1, unitId = asset().unit.id): Row => ({
  id: id(500 + n),
  unit_id: unitId,
  customer_id: id(600 + n),
  customer: { name: `Synthetic tenant ${n}` },
  contract_no: `SYNTHETIC-${n}`,
  status: "active",
  start_date: "2026-01-01",
  expected_end_date: "2030-01-01",
  actual_end_date: null,
  paid_through_date: "2026-12-31",
  rent_currency: "XOF",
  monthly_rent_xof: 1000,
  payment_cycle: "monthly",
  payment_day: 1,
  deposit_amount_xof: 2000,
  deposit_received: false,
  rent_free_days: 0,
  signer_name: null,
  attachment_url: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
});
const receipts = (count: number, lease = contract()): Row[] =>
  Array.from({ length: count }, (_, n) => ({
    id: id(10000 + n),
    source_id: lease.id,
    source_type: "lease_rent",
    unit_id: lease.unit_id,
    customer_id: lease.customer_id,
    payment_date: "2026-10-31",
    amount: 1,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    native_settlement: false,
    payment_method: "cash",
    receipt_no: null,
    external_receipt_no: null,
    notes: null,
    request_kind: null,
    reversal_of_payment_id: null,
    created_at: "2026-10-31T12:00:00Z",
  }));
function database(
  tables: Record<string, Row[]>,
  options: { cap?: number; failAfterFirstCashPage?: boolean; foreignContract?: boolean } = {},
) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        const filters: [string, readonly unknown[]][] = [];
        const query = {
          select() {
            return query;
          },
          in(key: string, values: readonly unknown[]) {
            filters.push([key, values]);
            return query;
          },
          order() {
            return query;
          },
          async range(from: number, to: number) {
            calls.push({ table, filters: [...filters], from, to });
            let rows = (tables[table] ?? [])
              .filter((row) => filters.every(([key, values]) => values.includes(row[key])))
              .sort((a, b) => a.id.localeCompare(b.id));
            if (options.foreignContract && table === "lease_contracts")
              rows = [{ ...contract(), unit_id: id(999999) }];
            if (options.failAfterFirstCashPage && table === "payments" && from > 0)
              return {
                data: null,
                error: { message: "Synthetic later page denied" },
                count: rows.length,
              };
            return {
              data: rows.slice(from, Math.min(to + 1, from + (options.cap ?? 1000))),
              error: null,
              count: rows.length,
            };
          },
        };
        return query;
      },
    } as unknown as Parameters<typeof readUnitBusinessSummaries>[0],
  };
}

describe("bounded current asset business reads", () => {
  it("reads cash beyond one thousand rows despite a lower Data API page cap before calculating totals", async () => {
    const db = database({ lease_contracts: [contract()], payments: receipts(1203) }, { cap: 317 });
    const summaries = await readUnitBusinessSummaries(db.client, [asset()], building, "2026-11-08");
    const record = summaries[asset().unit.id].leases[0];
    expect(summaries[asset().unit.id].status).toBe("ready");
    expect(record.rentReceived).toEqual([{ currency: "XOF", amount: 1203 }]);
    expect(record.receiptCount).toBe(1203);
    expect(record.recentReceipts).toHaveLength(6);
    expect(db.calls.filter((call) => call.table === "payments").length).toBeGreaterThan(1);
  });
  it("batches exact authorized asset IDs including a selected asset outside card filters without per-room reads", async () => {
    const visible = Array.from({ length: 101 }, (_, n) => asset(n + 1));
    const selected = asset(9000);
    const foreign = asset(9999, id(9999));
    const firstLease = contract();
    const selectedLease = contract(2, selected.unit.id);
    const db = database({
      lease_contracts: [firstLease, selectedLease, { ...contract(3), status: "terminated" }],
    });
    const summaries = await readUnitBusinessSummaries(
      db.client,
      [...visible, selected, visible[0], foreign],
      building,
      "2026-11-08",
    );
    expect(Object.keys(summaries)).toHaveLength(102);
    expect(summaries[selected.unit.id].leases[0].recordId).toBe(selectedLease.id);
    expect(summaries[foreign.unit.id]).toBeUndefined();
    expect(summaries[visible[0].unit.id].leases.map((record) => record.recordId)).toEqual([
      firstLease.id,
    ]);
    const reads = db.calls.filter((call) =>
      ["lease_contracts", "sale_contracts", "daily_bookings"].includes(call.table),
    );
    expect(reads.length).toBeGreaterThan(3);
    expect(reads.length).toBeLessThan(12);
    const allowed = new Set([...visible, selected].map((record) => record.unit.id));
    for (const call of reads) {
      const ids = call.filters.find(([key]) => key === "unit_id")![1];
      expect(ids.length).toBeLessThanOrEqual(100);
      expect(ids.every((value) => allowed.has(String(value)))).toBe(true);
      expect(call.filters).toContainEqual([
        "status",
        call.table === "daily_bookings" ? ["checked_in"] : ["active", "draft"],
      ]);
    }
  });
  it("fails business facts closed if the scoped response contains another asset rather than attaching its party", async () => {
    const db = database({}, { foreignContract: true });
    const summaries = await readUnitBusinessSummaries(db.client, [asset()], building, "2026-11-08");
    expect(summaries[asset().unit.id]).toMatchObject({
      status: "unavailable",
      sales: [],
      leases: [],
    });
    expect(summaries[asset().unit.id].reviewReasons.length).toBeGreaterThan(0);
    expect(db.calls.some((call) => call.table === "payments")).toBe(false);
  });
  it("does not turn a partial cash read into a healthy partial total or zero after a later page fails", async () => {
    const db = database(
      { lease_contracts: [contract()], payments: receipts(1203) },
      { cap: 317, failAfterFirstCashPage: true },
    );
    const summaries = await readUnitBusinessSummaries(db.client, [asset()], building, "2026-11-08");
    expect(db.calls.some((call) => call.table === "payments" && call.from > 0)).toBe(true);
    expect(summaries[asset().unit.id]).toMatchObject({
      status: "unavailable",
      sales: [],
      leases: [],
    });
  });
  it("does not query a sale catalogue for a rent-only building or attach a terminated tenant as current", async () => {
    const current = contract();
    const db = database({ lease_contracts: [current, { ...contract(2), status: "terminated" }] });
    const summaries = await readUnitBusinessSummaries(
      db.client,
      [asset()],
      { ...building, allows_sale: false },
      "2026-11-08",
    );
    expect(summaries[asset().unit.id].status).toBe("ready");
    expect(summaries[asset().unit.id].leases.map((record) => record.recordId)).toEqual([
      current.id,
    ]);
    expect(db.calls.some((call) => call.table === "sale_contracts")).toBe(false);
  });
});
