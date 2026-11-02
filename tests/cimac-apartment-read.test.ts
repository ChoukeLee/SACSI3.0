import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { readCimacApartments } from "@/features/cimac/cimac-apartment-read";
import { cimacApartmentPlan } from "@/features/cimac/cimac-apartment-model";
import type { CimacWorkspaceScope } from "@/features/cimac/cimac-workspace-types";

type Row = Record<string, unknown>;
const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const building = id(2),
  project = id(1);
let tables: Record<string, Row[]>,
  errors: Record<string, { code: string }>,
  calls: { table: string; fields: string; filters: [string, unknown][] }[],
  wrongCount: boolean;
const scope: CimacWorkspaceScope = {
  project: { id: project, code: "CIMAC", displayName: "Synthetic park" },
  buildings: [
    {
      id: building,
      code: "CIMAC-B17",
      name: "Synthetic B17",
      constructionStatus: "unverified",
      isActive: true,
    },
  ],
};
const plans = cimacApartmentPlan();
const profile = (index: number): Row => ({
  unit_id: id(index + 10),
  building_id: building,
  floor_number: plans[index].floor,
  room_suffix: plans[index].suffix,
  bedrooms: plans[index].bedrooms,
  facing: plans[index].facing,
  monthly_rent_xof: plans[index].monthlyRentXof,
  monthly_property_fee_xof: plans[index].monthlyPropertyFeeXof,
  deposit_months: 2,
  rent_prepay_months: 6,
  property_prepay_months: 12,
});
const unit = (index: number): Row => ({
  id: id(index + 10),
  building_id: building,
  code: `CIMAC-B17-${plans[index].unitNo}`,
  unit_no: plans[index].unitNo,
  kind: "apartment",
  asset_subtype: "apartment",
  floor_label: `${plans[index].floor}F`,
  area_sqm: null,
  construction_status: "unverified",
  occupancy_verified: false,
  updated_at: "2026-11-02T18:00:00.000000+00:00",
  notes: "DO_NOT_FORWARD",
});
const position = (index: number): Row => ({
  id: id(index + 10),
  building_id: building,
  operational_condition: "normal",
  daily_occupied: false,
  lease_occupied: false,
});
const client = {
  from(table: string) {
    const call = { table, fields: "", filters: [] as [string, unknown][] };
    calls.push(call);
    const builder = {
      select(fields: string) {
        call.fields = fields;
        return builder;
      },
      eq(key: string, value: unknown) {
        call.filters.push([key, value]);
        return builder;
      },
      in(key: string, value: unknown[]) {
        call.filters.push([key, value]);
        return builder;
      },
      order() {
        return builder;
      },
      async range(from: number, to: number) {
        const rows = tables[table] ?? [];
        return {
          data: rows.slice(from, to + 1),
          error: errors[table] ?? null,
          count: rows.length + (wrongCount ? 1 : 0),
        };
      },
    };
    return builder;
  },
} as unknown as SupabaseClient;
beforeEach(() => {
  tables = {
    cimac_apartment_profiles: plans.map((_, i) => profile(i)),
    units: plans.map((_, i) => unit(i)),
    unit_operational_position: plans.map((_, i) => position(i)),
    cimac_apartment_reservations: [],
  };
  errors = {};
  calls = [];
  wrongCount = false;
});
describe("apartment RLS-scoped read and quote boundary", () => {
  it("loads 64 registered records in four bounded queries and leaves occupancy unknown", async () => {
    const data = await readCimacApartments(client, scope);
    expect(data.registeredCount).toBe(64);
    expect(data.rooms.every((r) => r.occupancyState === "unknown")).toBe(true);
    expect(data.rooms[0]).not.toHaveProperty("notes");
    expect(JSON.stringify(data)).not.toContain("DO_NOT_FORWARD");
    expect(calls).toHaveLength(4);
    expect(
      calls.every((c) =>
        c.filters.some(([key, value]) => key === "building_id" && value === building),
      ),
    ).toBe(true);
    expect(calls.every((c) => !c.fields.includes("*") && !c.fields.includes("phone"))).toBe(true);
  });
  it("distinguishes a missing deployment from an uninitialized catalogue", async () => {
    errors.cimac_apartment_profiles = { code: "PGRST205" };
    let data = await readCimacApartments(client, scope);
    expect(data.schemaAvailable).toBe(false);
    expect(data.registeredCount).toBe(0);
    expect(
      data.rooms.every((r) => r.unitId === null && !r.registered && r.occupancyState === "unknown"),
    ).toBe(true);
    errors = {};
    tables.cimac_apartment_profiles = [];
    data = await readCimacApartments(client, scope);
    expect(data.schemaAvailable).toBe(true);
    expect(data.registeredCount).toBe(0);
    expect(calls).toHaveLength(2);
  });
  it("does not turn ACL failures or network failures into a false empty inventory", async () => {
    errors.cimac_apartment_profiles = { code: "42501" };
    await expect(readCimacApartments(client, scope)).rejects.toMatchObject({ status: 403 });
    errors.cimac_apartment_profiles = { code: "NETWORK" };
    await expect(readCimacApartments(client, scope)).rejects.toMatchObject({ status: 503 });
  });
  it("requires the exact active CIMAC building in the actor's scope before any read", async () => {
    await expect(readCimacApartments(client, { ...scope, buildings: [] })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      readCimacApartments(client, {
        ...scope,
        buildings: [{ ...scope.buildings[0], code: "OTHER-B17" }],
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(0);
  });
  it("reports only verified business occupancy and never invents actual resident names", async () => {
    tables.units[0].occupancy_verified = true;
    tables.units[1].occupancy_verified = true;
    tables.unit_operational_position[0].lease_occupied = true;
    const data = await readCimacApartments(client, scope);
    expect(data.rooms[0].occupancyState).toBe("occupied");
    expect(data.rooms[1].occupancyState).toBe("unoccupied");
    expect(data.rooms[2].occupancyState).toBe("unknown");
    expect(data.rooms[0]).not.toHaveProperty("occupantName");
  });
  it("retains unknown occupancy when its independent position row is missing", async () => {
    tables.units[0].occupancy_verified = true;
    tables.unit_operational_position = tables.unit_operational_position.slice(1);
    expect((await readCimacApartments(client, scope)).rooms[0].occupancyState).toBe("unknown");
  });
  it("shows an unpaid room hold without turning it into an actual resident or verified occupancy", async () => {
    tables.cimac_apartment_reservations = [
      {
        id: id(100),
        unit_id: id(10),
        building_id: building,
        reserver_name: "Synthetic Booker",
        status: "reserved",
        payment_status: "unpaid",
        updated_at: "2026-11-02T18:01:00.123456+00:00",
      },
    ];
    const data = await readCimacApartments(client, scope);
    expect(data.reservationSchemaAvailable).toBe(true);
    expect(data.rooms[0]).toMatchObject({
      occupancyState: "unknown",
      reservation: { reserverName: "Synthetic Booker", paymentStatus: "unpaid" },
    });
    expect(data.rooms[0]).not.toHaveProperty("occupantName");
    errors.cimac_apartment_reservations = { code: "PGRST205" };
    const older = await readCimacApartments(client, scope);
    expect(older.reservationSchemaAvailable).toBe(false);
    expect(older.rooms[0].reservation).toBeNull();
  });
  it("does not hide denied reservations or a duplicate/foreign hold as vacant", async () => {
    errors.cimac_apartment_reservations = { code: "42501" };
    await expect(readCimacApartments(client, scope)).rejects.toMatchObject({ status: 403 });
    errors = {};
    tables.cimac_apartment_reservations = [
      {
        id: id(100),
        unit_id: id(99),
        building_id: building,
        reserver_name: "Synthetic Booker",
        status: "reserved",
        payment_status: "unpaid",
        updated_at: "2026-11-02T18:01:00Z",
      },
    ];
    await expect(readCimacApartments(client, scope)).rejects.toThrow();
  });
  it.each([
    "profile building",
    "duplicate profile",
    "wrong price",
    "wrong facing",
    "commercial asset",
    "mismatched room",
    "foreign position",
    "bad area",
    "missing unit",
    "wrong count",
  ])("rejects inconsistent payload: %s", async (kind) => {
    if (kind === "profile building") tables.cimac_apartment_profiles[0].building_id = id(99);
    if (kind === "duplicate profile")
      tables.cimac_apartment_profiles[1] = { ...tables.cimac_apartment_profiles[0] };
    if (kind === "wrong price") tables.cimac_apartment_profiles[0].monthly_rent_xof = 1;
    if (kind === "wrong facing") tables.cimac_apartment_profiles[0].facing = "west";
    if (kind === "commercial asset") tables.units[0].kind = "storefront";
    if (kind === "mismatched room") tables.units[0].unit_no = "1701";
    if (kind === "foreign position") tables.unit_operational_position[0].building_id = id(99);
    if (kind === "bad area") tables.units[0].area_sqm = -1;
    if (kind === "missing unit") tables.units.pop();
    if (kind === "wrong count") wrongCount = true;
    await expect(readCimacApartments(client, scope)).rejects.toThrow();
  });
});
