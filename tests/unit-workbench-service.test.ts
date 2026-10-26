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
            filters.every(([key, value]) => key.includes(".") || row[key] === value) &&
            (!ids || ids.includes(row.id)),
        );
        return {
          data: rows,
          count: rows.length,
          error: table === failure ? { message: "synthetic failure" } : null,
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
        in(_key: string, value: unknown[]) {
          ids = value;
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
  it("reads one building's lightweight index but only 50 complete assets and no business history", async () => {
    const result = await readUnitWorkbench(client());
    expect(result.rows).toHaveLength(50);
    expect(result.total).toBe(123);
    expect(result.scopeTotal).toBe(123);
    expect(result.summary).toEqual({ occupied: 1, attention: 2, unverified: 0 });
    expect(
      calls.every((call) =>
        ["buildings", "units", "unit_operational_position"].includes(call.table),
      ),
    ).toBe(true);
    const complete = calls.filter(
      (call) => call.table === "units" && call.columns.includes("area_sqm"),
    );
    expect(complete).toHaveLength(1);
    expect(complete[0].ids).toHaveLength(50);
    expect(complete[0].filters).toContainEqual(["building_id", building]);
    expect(result.buildings[1].allows_sale).toBe(false);
  });
  it("paginates with stable numeric asset order without truncating the scope total", async () => {
    const result = await readUnitWorkbench(client(), { page: "3" });
    expect(result.rows).toHaveLength(23);
    expect(result.rows[0].unit.unit_no).toBe("101");
    expect(result.rows.at(-1)?.unit.unit_no).toBe("123");
    expect(result.total).toBe(123);
  });
  it("reads future reservations explicitly and excludes them from current occupancy totals", async () => {
    Object.assign(tables.unit_operational_position[0], {
      lease_occupied: false,
      daily_occupied: false,
      lease_pending: true,
      lease_start_date: "2026-11-15",
    });
    tables.units[0].status = "leased";
    const result = await readUnitWorkbench(client());
    expect(result.summary.occupied).toBe(0);
    expect(result.rows[0].unit.status).toBe("leased");
    expect(result.rows[0].position).toMatchObject({
      lease_pending: true,
      lease_start_date: "2026-11-15",
    });
    const positionRead = calls.find((call) => call.table === "unit_operational_position");
    expect(positionRead?.columns.split(",")).toContain("lease_pending");
    expect(positionRead?.columns.split(",")).toContain("lease_start_date");
  });
  it("fully reads lightweight index pages even when the Data API limit is smaller", async () => {
    pageCap = 11;
    const result = await readUnitWorkbench(client(), { floor: "2F" });
    expect(result.total).toBe(68);
    expect(result.rows).toHaveLength(50);
    expect(calls.some((call) => call.table === "units" && call.from === 121)).toBe(true);
    expect(result.floors).toEqual(["1F", "2F"]);
  });
  it("resolves UUID and legacy building code links without global local-storage preference", async () => {
    const result = await readUnitWorkbench(client(), {
      project,
      building: "SACSI7",
      unit: uuid(220),
    });
    expect(result.query.building).toBe(building);
    expect(result.selected?.unit.unit_no).toBe("121");
    expect(result.rows.some((row) => row.unit.id === uuid(220))).toBe(false);
    expect(result.selectedUnavailable).toBe(false);
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
