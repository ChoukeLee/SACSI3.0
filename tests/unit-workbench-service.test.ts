import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { readUnitWorkbench } from "@/features/units/unit-workbench-service";

const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString().padStart(12, "0")}`;
const project = uuid(1),
  otherProject = uuid(2),
  building = uuid(3),
  otherBuilding = uuid(4);
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failure: string | null;
let calls: {
  table: string;
  columns: string;
  filters: [string, unknown][];
  ids: unknown[] | null;
  from?: number;
  to?: number;
}[];
let pageCap: number;
let detailFault: "missing" | "duplicate" | "foreign" | "rogueId" | "failure" | null;
function client(): Pick<SupabaseClient, "from"> {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let ids: unknown[] | null = null;
      let columns = "";
      const result = () => {
        calls.push({ table, columns, filters: [...filters], ids });
        const rows = (tables[table] ?? []).filter(
          (row) =>
            filters.every(
              ([key, value]) =>
                key.includes(".") ||
                (Array.isArray(value) ? value.includes(row[key]) : row[key] === value),
            ) &&
            (!ids || ids.includes(row.id)),
        );
        const fault = columns.includes("area_sqm") && ids?.includes(uuid(250)) ? detailFault : null;
        if (fault === "missing") rows.shift();
        if (fault === "duplicate") rows[0] = rows[1];
        if (fault === "foreign") rows[0] = { ...rows[0], building_id: otherBuilding };
        if (fault === "rogueId") rows[0] = { ...rows[0], id: uuid(999999) };
        return {
          data: rows,
          count: rows.length,
          error: table === failure || fault === "failure" ? { message: "synthetic failure" } : null,
        };
      };
      const query = {
        select(value: string) {
          columns = value;
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return query;
        },
        in(key: string, value: unknown[]) {
          if (key === "id") ids = value;
          else filters.push([key, value]);
          return query;
        },
        order() {
          return query;
        },
        async range(from: number, to: number) {
          const response = result();
          Object.assign(calls.at(-1)!, { from, to });
          return { ...response, data: response.data.slice(from, Math.min(to + 1, from + pageCap)) };
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
const unit = (n: number, extra: Row = {}) => ({
  id: uuid(100 + n),
  building_id: building,
  unit_no: String(n + 1),
  code: `A-${n + 1}`,
  floor_label: n < 55 ? "1F" : "2F",
  kind: "apartment",
  status: "available",
  area_sqm: null,
  layout: null,
  furnishing: null,
  notes: null,
  occupancy_verified: true,
  construction_status: "operational",
  created_at: "2026-10-19",
  updated_at: "2026-10-19",
  unit_business_flags: [],
  ...extra,
});
beforeEach(() => {
  failure = null;
  calls = [];
  pageCap = Infinity;
  detailFault = null;
  tables = {
    buildings: [
      {
        id: building,
        project_id: project,
        code: "SACSI7",
        display_name: "7#",
        project: { code: "SACSI", display_name: "公寓", allows_sale: true },
        is_active: true,
      },
      {
        id: otherBuilding,
        project_id: otherProject,
        code: "CIMAC",
        display_name: "商铺",
        project: { code: "CIMAC", display_name: "建材城", allows_sale: true },
        is_active: true,
      },
    ],
    units: Array.from({ length: 123 }, (_, n) => unit(n)),
    unit_operational_position: Array.from({ length: 123 }, (_, n) => ({
      id: uuid(100 + n),
      building_id: building,
      ownership: n === 0 ? "sold" : "unspecified",
      operational_condition: n === 1 ? "maintenance" : "normal",
      daily_occupied: n === 0,
      lease_occupied: n === 0,
      cleaning_pending: n === 0,
      daily_enabled: false,
      lease_enabled: true,
    })),
  };
});

describe("bounded asset workbench reads", () => {
  it("defaults to all building assets in bounded batches with current-only business summaries", async () => {
    const result = await readUnitWorkbench(client());
    expect(result.query).toMatchObject({ view: "floor", page: 1 });
    expect(result.rows).toHaveLength(123);
    expect(result.total).toBe(123);
    expect(result.scopeTotal).toBe(123);
    expect(result.summary).toEqual({ occupied: 1, attention: 2, unverified: 0 });
    expect(
      calls.every((call) =>
        [
          "buildings",
          "units",
          "unit_operational_position",
          "lease_contracts",
          "sale_contracts",
          "daily_bookings",
        ].includes(call.table),
      ),
    ).toBe(true);
    const currentBusiness = calls.filter((call) =>
      ["lease_contracts", "sale_contracts", "daily_bookings"].includes(call.table),
    );
    expect(currentBusiness.length).toBeGreaterThan(0);
    expect(currentBusiness.length).toBeLessThan(12);
    for (const call of currentBusiness) {
      expect(call.filters).toContainEqual([
        "status",
        call.table === "daily_bookings" ? ["checked_in"] : ["active", "draft"],
      ]);
      const ids = call.filters.find(([key]) => key === "unit_id")?.[1] as string[];
      expect(ids.length).toBeLessThanOrEqual(100);
      expect(ids.every((id) => tables.units.some((unit) => unit.id === id))).toBe(true);
    }
    const complete = calls.filter(
      (call) => call.table === "units" && call.columns.includes("area_sqm"),
    );
    expect(complete).toHaveLength(2);
    expect(complete.map((call) => call.ids!.length)).toEqual([100, 23]);
    expect(
      complete.every((call) =>
        call.filters.some(([key, value]) => key === "building_id" && value === building),
      ),
    ).toBe(true);
    expect(result.buildings[1].allows_sale).toBe(false);
  });
  it("paginates with stable numeric asset order without truncating the scope total", async () => {
    const result = await readUnitWorkbench(client(), { view: "list", page: "3" });
    expect(result.rows).toHaveLength(23);
    expect(result.rows[0].unit.unit_no).toBe("101");
    expect(result.rows.at(-1)?.unit.unit_no).toBe("123");
    expect(result.total).toBe(123);
  });
  it("fully reads lightweight index pages even when the Data API limit is smaller", async () => {
    pageCap = 11;
    const result = await readUnitWorkbench(client(), { floor: "2F" });
    expect(result.total).toBe(68);
    expect(result.rows).toHaveLength(68);
    expect(calls.some((call) => call.table === "units" && call.from === 121)).toBe(true);
    expect(result.floors).toEqual(["1F", "2F"]);
  });
  it("resolves UUID and legacy building code links without global local-storage preference", async () => {
    const result = await readUnitWorkbench(client(), {
      project,
      building: "SACSI7",
      unit: uuid(220),
      view: "list",
    });
    expect(result.query.building).toBe(building);
    expect(result.selected?.unit.unit_no).toBe("121");
    expect(result.rows.some((row) => row.unit.id === uuid(220))).toBe(false);
    expect(result.selectedUnavailable).toBe(false);
  });
  it("returns more than one thousand full assets with stable order and no per-asset reads", async () => {
    tables.units = Array.from({ length: 1101 }, (_, n) => unit(n));
    tables.unit_operational_position = Array.from({ length: 1101 }, (_, n) => ({
      ...tables.unit_operational_position[1],
      id: uuid(100 + n),
    }));
    const result = await readUnitWorkbench(client(), { view: "floor", page: "99" });
    expect(result.query.page).toBe(1);
    expect(result.rows).toHaveLength(1101);
    expect(result.total).toBe(1101);
    expect(result.rows[0].unit.unit_no).toBe("1");
    expect(result.rows.at(-1)?.unit.unit_no).toBe("1101");
    const complete = calls.filter(
      (call) => call.table === "units" && call.columns.includes("area_sqm"),
    );
    expect(complete).toHaveLength(12);
    expect(complete.every((call) => call.ids!.length <= 100)).toBe(true);
    expect(new Set(complete.flatMap((call) => call.ids!)).size).toBe(1101);
  });
  it.each(["missing", "duplicate", "foreign", "rogueId", "failure"] as const)(
    "rejects the whole floor when a later detail batch is %s instead of showing a partial directory",
    async (fault) => {
      tables.units = Array.from({ length: 151 }, (_, n) => unit(n));
      detailFault = fault;
      await expect(readUnitWorkbench(client())).rejects.toThrow();
    },
  );
  it("keeps a selected asset available outside current card filters without substituting another asset", async () => {
    const result = await readUnitWorkbench(client(), { unit: uuid(220), q: "no matching unit" });
    expect(result.rows).toEqual([]);
    expect(result.selected?.unit.id).toBe(uuid(220));
    expect(result.selectedUnavailable).toBe(false);
  });
  it("includes sold, occupied, verified unoccupied and unknown assets in the default all range", async () => {
    tables.units[2].occupancy_verified = false;
    tables.unit_operational_position = tables.unit_operational_position.filter(
      (p) => p.id !== uuid(103),
    );
    const result = await readUnitWorkbench(client());
    expect(result.rows).toHaveLength(123);
    expect(result.rows[0].position).toMatchObject({
      ownership: "sold",
      daily_occupied: true,
      lease_occupied: true,
    });
    expect(result.rows.find((row) => row.unit.id === uuid(102))?.unit.occupancy_verified).toBe(
      false,
    );
    expect(result.rows.find((row) => row.unit.id === uuid(103))?.position).toBeNull();
    expect(result.summary.unverified).toBe(2);
  });
  it("resolves an asset-only deep link to its exact authorized building", async () => {
    tables.units.push(unit(900, { building_id: otherBuilding }));
    tables.unit_operational_position.push({
      ...tables.unit_operational_position[0],
      id: uuid(1000),
      building_id: otherBuilding,
    });
    const result = await readUnitWorkbench(client(), { unit: uuid(1000) });
    expect(result.building?.id).toBe(otherBuilding);
    expect(result.selected?.unit.id).toBe(uuid(1000));
    expect(result.query.project).toBe(otherProject);
  });
  it("does not replace a wrong-scope or inaccessible asset with the first asset", async () => {
    const result = await readUnitWorkbench(client(), { building: otherBuilding, unit: uuid(100) });
    expect(result.selected).toBeNull();
    expect(result.selectedUnavailable).toBe(true);
    expect(result.rows).toEqual([]);
    const malformed = await readUnitWorkbench(client(), { unit: "bad-id" });
    expect(malformed.selected).toBeNull();
    expect(malformed.selectedUnavailable).toBe(true);
  });
  it.each([
    { project: uuid(9999) },
    { building: uuid(9999) },
    { project: otherProject, building },
    { project: [project, otherProject] },
  ])("reports invalid explicit scope %# instead of all-scope zeros", async (input) => {
    const result = await readUnitWorkbench(client(), input);
    expect(result.scopeUnavailable).toBe(true);
    expect(result.building).toBeNull();
    expect(result.rows).toEqual([]);
  });
  it("keeps enabled and disabled configured prices, including zero, without fabricated defaults", async () => {
    tables.units[0].unit_business_flags = [
      {
        unit_id: uuid(100),
        business_type: "daily_rental",
        is_enabled: false,
        default_price_xof: 0,
      },
      {
        unit_id: uuid(100),
        business_type: "long_lease",
        is_enabled: true,
        default_price_xof: null,
      },
    ];
    const result = await readUnitWorkbench(client());
    expect(result.rows[0].flags).toEqual(tables.units[0].unit_business_flags);
    expect(result.rows[1].flags).toEqual([]);
  });
  it("excludes unverified non-occupied assets from the verified-unoccupied filter", async () => {
    tables.units[2].occupancy_verified = false;
    const result = await readUnitWorkbench(client(), { filter: "unoccupied" });
    expect(result.total).toBe(121);
    expect(result.rows.some((row) => row.unit.id === uuid(102))).toBe(false);
    expect(result.summary.unverified).toBe(1);
  });
  it("keeps a genuine filtered empty result distinct from invalid scope", async () => {
    const result = await readUnitWorkbench(client(), { q: "no matching unit" });
    expect(result.scopeUnavailable).toBe(false);
    expect(result.total).toBe(0);
    expect(result.scopeTotal).toBe(123);
    expect(result.summary.occupied).toBe(1);
  });
  it.each(["buildings", "units", "unit_operational_position"])(
    "fails closed when %s is unavailable",
    async (table) => {
      failure = table;
      await expect(readUnitWorkbench(client())).rejects.toThrow();
    },
  );
});
