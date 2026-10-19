import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { readUnitBusinessContext } from "@/features/units/unit-business-context-read";
import { decodeUnitBusinessContext } from "@/features/units/unit-workbench-model";

const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString().padStart(12, "0")}`;
const unit = uuid(1),
  building = uuid(2),
  project = uuid(3),
  tenant = uuid(4),
  guest = uuid(5),
  agent = uuid(6);
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failure: string | null;
let countOverride: number | undefined;
let calls: {
  table: string;
  columns: string;
  head: boolean;
  from?: number;
  to?: number;
  filters: [string, unknown][];
}[];
function client(): Pick<SupabaseClient, "from"> {
  return {
    from(table: string) {
      let columns = "",
        head = false;
      const filters: [string, unknown][] = [];
      const result = (from?: number, to?: number) => {
        calls.push({ table, columns, head, from, to, filters: [...filters] });
        const rows = (tables[table] ?? []).filter((row) =>
          filters.every(([key, value]) => row[key] === value),
        );
        return {
          data: from === undefined ? rows : rows.slice(from, to! + 1),
          count: countOverride ?? rows.length,
          error: table === failure ? { message: "synthetic unavailable" } : null,
        };
      };
      const query = {
        select(value: string, options?: { head?: boolean }) {
          columns = value;
          head = !!options?.head;
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return query;
        },
        order() {
          return query;
        },
        async range(from: number, to: number) {
          return result(from, to);
        },
        async maybeSingle() {
          const response = result();
          return { ...response, data: response.data[0] ?? null };
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return query;
    },
  } as unknown as Pick<SupabaseClient, "from">;
}
beforeEach(() => {
  failure = null;
  countOverride = undefined;
  calls = [];
  tables = {
    units: [{ id: unit, building_id: building }],
    buildings: [{ id: building, project_id: project }],
    lease_contracts: [
      {
        id: uuid(10),
        unit_id: unit,
        customer_id: tenant,
        contract_no: "L-1",
        status: "active",
        start_date: "2026-01-01",
        expected_end_date: "2027-01-01",
        expected_end_confirmed: false,
        customer: { name: "Explicit tenant" },
      },
    ],
    sale_contracts: [
      {
        id: uuid(11),
        unit_id: unit,
        customer_id: tenant,
        contract_no: "S-1",
        status: "active",
        signed_date: "2026-02-01",
        customer: [{ name: "Explicit buyer" }],
      },
    ],
    daily_bookings: [
      {
        id: uuid(12),
        unit_id: unit,
        customer_id: agent,
        guest_customer_id: guest,
        guest_name: "Fallback guest",
        booking_agent_id: agent,
        status: "checked_in",
        check_in: "2026-10-01",
        check_out: "2026-10-30",
        checkout_mode: "open",
        guest: { name: "Actual guest" },
        agent: { name: "Booking agent" },
      },
    ],
  };
});

describe("exact-asset paginated business relations", () => {
  it("prefers actual lease departure over the expected end and labels each date kind", async () => {
    Object.assign(tables.lease_contracts[0], {
      actual_end_date: "2026-09-15",
      expected_end_confirmed: false,
      expected_end_date: "2099-12-31",
      status: "terminated",
    });
    const ended = (await readUnitBusinessContext(client(), unit, 1)).relations[0];
    expect(ended).toMatchObject({ end: "2026-09-15", endDateKind: "actual", endConfirmed: true });
    Object.assign(tables.lease_contracts[0], {
      actual_end_date: null,
      expected_end_confirmed: true,
      expected_end_date: "2027-01-01",
      status: "active",
    });
    const expected = (await readUnitBusinessContext(client(), unit, 1)).relations[0];
    expect(expected).toMatchObject({
      end: "2027-01-01",
      endDateKind: "expected",
      endConfirmed: true,
    });
  });
  it.each([true, false, undefined])(
    "does not promote a 2099 placeholder into a confirmed end date (%s)",
    async (confirmed) => {
      Object.assign(tables.lease_contracts[0], {
        expected_end_date: "2099-12-31",
        expected_end_confirmed: confirmed,
      });
      expect((await readUnitBusinessContext(client(), unit, 1)).relations[0]).toMatchObject({
        end: null,
        endDateKind: null,
        endConfirmed: false,
      });
    },
  );
  it("distinguishes fixed planned checkout from actual departure and an open stay", async () => {
    Object.assign(tables.daily_bookings[0], { checkout_mode: "fixed" });
    expect((await readUnitBusinessContext(client(), unit, 1)).relations[2]).toMatchObject({
      end: "2026-10-30",
      endDateKind: "expected",
    });
    Object.assign(tables.daily_bookings[0], { actual_check_out: "2026-10-19" });
    expect((await readUnitBusinessContext(client(), unit, 1)).relations[2]).toMatchObject({
      end: "2026-10-19",
      endDateKind: "actual",
    });
    Object.assign(tables.daily_bookings[0], { actual_check_out: null, checkout_mode: "open" });
    expect((await readUnitBusinessContext(client(), unit, 1)).relations[2]).toMatchObject({
      end: null,
      endDateKind: null,
    });
  });
  it("keeps purchaser, tenant, actual guest and booking agent explicit without current-occupant inference", async () => {
    const result = await readUnitBusinessContext(client(), unit, 1, { building, project });
    expect(decodeUnitBusinessContext(result, unit, 1)).toEqual(result);
    expect(result.relations[0]).toMatchObject({
      type: "lease",
      customerId: tenant,
      customerName: "Explicit tenant",
      endConfirmed: false,
    });
    expect(result.relations[1]).toMatchObject({
      type: "sale",
      customerId: tenant,
      customerName: "Explicit buyer",
    });
    expect(result.relations[2]).toMatchObject({
      type: "daily",
      customerId: guest,
      customerName: "Actual guest",
      agentId: agent,
      agentName: "Booking agent",
      end: null,
    });
    expect(
      calls
        .filter((call) => call.from !== undefined)
        .every((call) => call.filters.some(([key, value]) => key === "unit_id" && value === unit)),
    ).toBe(true);
    expect(
      calls.some((call) =>
        ["payments", "ledger_entries", "receivables", "audit_logs"].includes(call.table),
      ),
    ).toBe(false);
  });
  it("does not promote legacy booking customer into guest or booking-agent identity", async () => {
    Object.assign(tables.daily_bookings[0], {
      guest_customer_id: null,
      guest: null,
      guest_name: "Only named guest",
      booking_agent_id: null,
      agent: null,
    });
    const row = (await readUnitBusinessContext(client(), unit, 1)).relations[2];
    expect(row).toMatchObject({
      customerId: null,
      customerName: "Only named guest",
      agentId: null,
      agentName: null,
    });
  });
  it("preserves actual departure instead of replacing it with planned checkout", async () => {
    Object.assign(tables.daily_bookings[0], {
      checkout_mode: "fixed",
      actual_check_out: "2026-10-19",
    });
    expect((await readUnitBusinessContext(client(), unit, 1)).relations[2].end).toBe("2026-10-19");
  });
  it("paginates all domains with at most 30 total relationship rows per response", async () => {
    tables.lease_contracts = Array.from({ length: 37 }, (_, n) => ({
      ...tables.lease_contracts[0],
      id: uuid(100 + n),
    }));
    tables.sale_contracts = Array.from({ length: 19 }, (_, n) => ({
      ...tables.sale_contracts[0],
      id: uuid(200 + n),
    }));
    tables.daily_bookings = Array.from({ length: 12 }, (_, n) => ({
      ...tables.daily_bookings[0],
      id: uuid(300 + n),
    }));
    const result = await readUnitBusinessContext(client(), unit, 2);
    expect(result.total).toBe(68);
    expect(result.relations).toHaveLength(30);
    expect(result.relations.filter((row) => row.type === "lease")).toHaveLength(7);
    expect(result.relations.filter((row) => row.type === "sale")).toHaveLength(19);
    expect(result.relations.filter((row) => row.type === "daily")).toHaveLength(4);
    expect(
      calls
        .filter((call) => call.from !== undefined)
        .reduce((sum, call) => sum + call.to! - call.from! + 1, 0),
    ).toBe(30);
    expect(
      decodeUnitBusinessContext(await readUnitBusinessContext(client(), unit, 3), unit, 3)
        .relations,
    ).toHaveLength(8);
  });
  it.each([
    { unit: uuid(999), scope: undefined },
    { unit, scope: { building: uuid(999) } },
    { unit, scope: { project: uuid(999) } },
  ])("rejects missing or wrong-scope target %# before reading relations", async (input) => {
    await expect(
      readUnitBusinessContext(client(), input.unit, 1, input.scope),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      calls.some((call) => call.table.endsWith("contracts") || call.table === "daily_bookings"),
    ).toBe(false);
  });
  it("returns unavailable rather than no history after an underlying read failure", async () => {
    failure = "daily_bookings";
    await expect(readUnitBusinessContext(client(), unit, 1)).rejects.toMatchObject({ status: 503 });
  });
  it("rejects a truncated response rather than claiming a complete business history", async () => {
    countOverride = 10;
    await expect(readUnitBusinessContext(client(), unit, 1)).rejects.toMatchObject({ status: 503 });
  });
  it("supports genuine empty relations without fabricating current customer", async () => {
    tables.lease_contracts = [];
    tables.sale_contracts = [];
    tables.daily_bookings = [];
    expect(await readUnitBusinessContext(client(), unit, 1)).toEqual({
      unitId: unit,
      buildingId: building,
      projectId: project,
      total: 0,
      page: 1,
      relations: [],
    });
    await expect(readUnitBusinessContext(client(), unit, 2)).rejects.toMatchObject({ status: 404 });
  });
});
