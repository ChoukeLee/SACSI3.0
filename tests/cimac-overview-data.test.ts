import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  calls: [] as unknown[][],
  failedTable: "",
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      mock.calls.push([table, "from"]);
      const result = () => ({
        data: mock.failedTable === table ? null : (mock.tables[table] ?? []),
        error: mock.failedTable === table ? { message: "synthetic read unavailable" } : null,
      });
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        in: vi.fn(),
        order: vi.fn(),
        range: vi.fn(async (from: number, to: number) => {
          mock.calls.push([table, "range", from, to]);
          return result();
        }),
        maybeSingle: vi.fn(async () => {
          const response = result();
          return { ...response, data: response.data?.[0] ?? null };
        }),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      for (const method of ["select", "eq", "in", "order"] as const)
        chain[method].mockImplementation((...args: unknown[]) => {
          mock.calls.push([table, method, ...args]);
          return chain;
        });
      return chain;
    },
  }),
}));
import { getCimacOverview } from "@/features/cimac/cimac-overview-data";

const projectId = "11111111-1111-4111-8111-111111111111";
const buildingId = "22222222-2222-4222-8222-222222222222";
const baseUnit = {
  building_id: buildingId,
  kind: "storefront",
  asset_subtype: "commercial_shop",
  construction_status: "operational",
  status: "available",
  occupancy_verified: true,
  reservation_holder_name: null,
  reservation_main_business: null,
  unit_business_flags: [
    { business_type: "long_lease", is_enabled: true, default_price_xof: 100000 },
  ],
};
beforeEach(() => {
  mock.calls = [];
  mock.failedTable = "";
  mock.tables = {
    projects: [
      {
        id: projectId,
        code: "CIMAC",
        display_name: "CIMAC",
        brand_name: "CIMAC",
        construction_status: "under_construction",
        allows_sale: false,
      },
    ],
    buildings: [{ id: buildingId, code: "CIMAC-B06", display_name: "第六栋" }],
    units: [
      {
        ...baseUnit,
        id: "shop-601",
        unit_no: "601",
        area_sqm: 64,
        location_grade: "central_avenue_prime",
        status: "leased",
      },
      {
        ...baseUnit,
        id: "shop-602",
        unit_no: "602",
        area_sqm: null,
        location_grade: "standard",
        status: "reserved",
        occupancy_verified: false,
        construction_status: "unverified",
        reservation_holder_name: "预留商户",
        reservation_main_business: "家具",
      },
      {
        ...baseUnit,
        id: "apartment",
        unit_no: "A01",
        kind: "apartment",
        asset_subtype: "apartment",
        area_sqm: 80,
      },
    ],
    lease_contracts: [{ unit_id: "shop-601", customers: [{ name: "正式合同客户" }] }],
  };
});
describe("CIMAC overview reader extracted without changing map business", () => {
  it("scopes buildings, paged units and active leases to the verified CIMAC project", async () => {
    const data = await getCimacOverview();
    expect(mock.calls).toContainEqual(["projects", "eq", "code", "CIMAC"]);
    expect(mock.calls).toContainEqual(["buildings", "eq", "project_id", projectId]);
    expect(mock.calls).toContainEqual(["units", "in", "building_id", [buildingId]]);
    expect(mock.calls).toContainEqual(["units", "range", 0, 999]);
    expect(mock.calls).toContainEqual(["lease_contracts", "in", "units.building_id", [buildingId]]);
    expect(mock.calls).toContainEqual(["lease_contracts", "eq", "status", "active"]);
    expect(data).toMatchObject({
      project: { id: projectId },
      shopCount: 2,
      buildingCount: 1,
      primeCount: 1,
      standardCount: 1,
      leasedCount: 1,
      unverifiedCount: 1,
    });
  });
  it("keeps explicit contract tenants, reservation evidence, unknown areas and separate asset kinds", async () => {
    const data = await getCimacOverview();
    expect(data?.buildings[0].shops[0]).toMatchObject({
      unitNo: "601",
      tenantName: "正式合同客户",
      hasActiveLease: true,
      isPrime: true,
    });
    expect(data?.buildings[0].shops[1]).toMatchObject({
      unitNo: "602",
      tenantName: "预留商户",
      mainBusiness: "家具",
      hasActiveLease: false,
      areaSqm: null,
    });
    expect(
      data?.assetInventory.find((group) => group.subtype === "commercial_shop")?.areaSqm,
    ).toBeNull();
    expect(data?.assetInventory.find((group) => group.subtype === "apartment")).toMatchObject({
      count: 1,
      areaSqm: 80,
    });
    expect(data?.standardMonthlyRentXof).toBe(200000);
  });
  it("does not read global inventory or leases when no authorized project/buildings exist", async () => {
    mock.tables.projects = [];
    expect(await getCimacOverview()).toBeNull();
    expect(mock.calls.some(([table]) => table !== "projects")).toBe(false);
    mock.tables.projects = [{ id: projectId }];
    mock.tables.buildings = [];
    mock.calls = [];
    expect((await getCimacOverview())?.shopCount).toBe(0);
    expect(mock.calls.some(([table]) => table === "units" || table === "lease_contracts")).toBe(
      false,
    );
  });
  it.each(["projects", "buildings", "units", "lease_contracts"])(
    "never substitutes a successful zero inventory when %s fails",
    async (table) => {
      mock.failedTable = table;
      await expect(getCimacOverview()).rejects.toThrow();
    },
  );
});
