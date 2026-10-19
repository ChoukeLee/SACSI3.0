import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  create: vi.fn(),
  from: vi.fn(),
  calls: [] as unknown[],
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getCurrentUser: mocks.user,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));

import { GET } from "@/app/api/finance/manual-options/route";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const buildingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherBuildingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const unitId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const building = { id: buildingId, project_id: projectId, display_name: "授权楼栋", code: "B1" };
const unit = { id: unitId, building_id: buildingId, unit_no: "101" };
let buildings: unknown[];
let units: unknown[];
let databaseError: { message: string } | null;
let failFrom: number | null;
const request = (query = "") =>
  new Request(`https://sacsi.example/api/finance/manual-options${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  buildings = [building];
  units = [unit];
  databaseError = null;
  failFrom = null;
  mocks.user.mockResolvedValue({ id: "operator", role: "admin" });
  mocks.create.mockResolvedValue({ from: mocks.from });
  mocks.from.mockImplementation((table: string) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((field: string, value: unknown) => {
        filters.push([field, value]);
        return builder;
      }),
      order: vi.fn().mockReturnThis(),
      range: vi.fn(async (from: number, to: number) => {
        mocks.calls.push({ table, filters, from, to });
        const data = table === "buildings" ? buildings : units;
        return {
          data: data.slice(from, to + 1),
          error:
            failFrom !== null && from >= failFrom
              ? { message: "synthetic later page failure" }
              : databaseError,
          count: data.length,
        };
      }),
    };
    return builder;
  });
});

describe("manual entry metadata API", () => {
  it("requires a verified identity before creating a database client", async () => {
    mocks.user.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(["boss", "front_desk", "rental_sales"])(
    "does not grant metadata access to %s",
    async (role) => {
      mocks.user.mockResolvedValue({ id: "operator", role });
      expect((await GET(request())).status).toBe(403);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it.each(["admin", "finance"])(
    "allows %s but returns only authorized building catalog without a target",
    async (role) => {
      mocks.user.mockResolvedValue({ id: "operator", role });
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        scope: { projectId: null, buildingId: null },
        buildings: [building],
        units: [],
      });
      expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["buildings"]);
      expect(mocks.calls).toEqual([
        { table: "buildings", filters: [["is_active", true]], from: 0, to: 999 },
      ]);
    },
  );

  it("scopes a project catalog without loading its units", async () => {
    const response = await GET(request(`?projectId=${projectId}`));
    expect(response.status).toBe(200);
    expect(mocks.calls).toContainEqual({
      table: "buildings",
      filters: [
        ["is_active", true],
        ["project_id", projectId],
      ],
      from: 0,
      to: 999,
    });
    expect(mocks.from).not.toHaveBeenCalledWith("units");
  });

  it("loads units only after matching the selected building and project", async () => {
    const response = await GET(request(`?projectId=${projectId}&buildingId=${buildingId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scope: { projectId, buildingId },
      buildings: [building],
      units: [unit],
    });
    expect(mocks.calls).toEqual([
      {
        table: "buildings",
        filters: [
          ["is_active", true],
          ["project_id", projectId],
          ["id", buildingId],
        ],
        from: 0,
        to: 999,
      },
      { table: "units", filters: [["building_id", buildingId]], from: 0, to: 999 },
    ]);
  });

  it("also supports an explicit building-only scope", async () => {
    const response = await GET(request(`?buildingId=${buildingId}`));
    expect(response.status).toBe(200);
    expect((await response.json()).scope).toEqual({ projectId: null, buildingId });
  });

  it.each([
    "?projectId=",
    "?buildingId=",
    "?projectId=not-a-uuid",
    `?projectId=${projectId}&projectId=${projectId}`,
    `?buildingId=${buildingId}&buildingId=${buildingId}`,
    "?userId=someone-else",
  ])("rejects empty, invalid, repeated or unknown scope parameters %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not fall back to other buildings when the requested one is absent or RLS-hidden", async () => {
    buildings = [];
    expect((await GET(request(`?buildingId=${buildingId}`))).status).toBe(404);
    expect(mocks.from).not.toHaveBeenCalledWith("units");
  });

  it("treats no authorized buildings without a requested scope as a genuine empty result", async () => {
    buildings = [];
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).buildings).toEqual([]);
  });

  it("fails closed when building metadata violates the requested project", async () => {
    buildings = [{ ...building, project_id: otherBuildingId }];
    expect((await GET(request(`?projectId=${projectId}&buildingId=${buildingId}`))).status).toBe(
      503,
    );
    expect(mocks.from).not.toHaveBeenCalledWith("units");
  });

  it("fails closed when unit metadata belongs to another building", async () => {
    units = [{ ...unit, building_id: otherBuildingId }];
    const response = await GET(request(`?buildingId=${buildingId}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "manualEntryOptionsUnavailable" });
  });

  it("does not render a failed database read as empty options", async () => {
    databaseError = { message: "synthetic database outage" };
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "manualEntryOptionsUnavailable" });
  });

  it("reads all selected-building units in stable pages instead of silently truncating metadata", async () => {
    units = Array.from({ length: 1001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      building_id: buildingId,
      unit_no: `U${index}`,
    }));
    const response = await GET(request(`?buildingId=${buildingId}`));
    expect(response.status).toBe(200);
    expect((await response.json()).units).toHaveLength(1001);
    expect(mocks.calls).toContainEqual({
      table: "units",
      filters: [["building_id", buildingId]],
      from: 1000,
      to: 1999,
    });
  });

  it("rejects the entire metadata result when a later page fails", async () => {
    units = Array.from({ length: 1001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      building_id: buildingId,
      unit_no: `U${index}`,
    }));
    failFrom = 1000;
    const response = await GET(request(`?buildingId=${buildingId}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "manualEntryOptionsUnavailable" });
  });

  it("does not expose raw identity or database failure messages", async () => {
    mocks.user.mockRejectedValue(new Error("PRIVATE_BACKEND_DETAILS"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("PRIVATE_BACKEND_DETAILS");
  });
});
