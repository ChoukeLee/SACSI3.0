import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { redirectLegacyCimac } from "@/features/cimac/cimac-legacy-redirect";
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
let tables: Record<string, Record<string, unknown>[]>;
let calls: string[];
let fail: string | null;
beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  fail = null;
  tables = {
    projects: [{ id: id(1), code: "CIMAC", is_active: true }],
    buildings: [
      { id: id(2), code: "CIMAC-B01", project_id: id(1) },
      { id: id(3), code: "SACSI11", project_id: id(9) },
    ],
    units: [
      { id: id(4), building_id: id(2) },
      { id: id(5), building_id: id(3) },
    ],
    lease_contracts: [{ id: id(6), unit_id: id(4) }],
    sale_contracts: [{ id: id(7), unit_id: id(4) }],
  };
  mocks.create.mockResolvedValue({
    from(table: string) {
      calls.push(table);
      const filters: [string, unknown][] = [];
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return query;
        },
        async maybeSingle() {
          return {
            data:
              (tables[table] ?? []).find((row) =>
                filters.every(([key, value]) => row[key] === value),
              ) ?? null,
            error: table === fail ? { code: "synthetic" } : null,
          };
        },
      };
      return query;
    },
  });
});
describe("legacy redirects resolve current-user project facts", () => {
  it("does not fetch metadata for an ordinary unfiltered SACSI visit", async () => {
    await redirectLegacyCimac("finance", {}, "zh");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["CIMAC", id(1)])("recognizes explicit park project %s", async (project) => {
    await expect(
      redirectLegacyCimac("customers", { project, customer: id(8) }, "zh"),
    ).rejects.toThrow(`redirect:/cimac/customers/${id(8)}`);
  });
  it("recognizes the former customer-account-only URL", async () => {
    await expect(
      redirectLegacyCimac("finance", { view: "customers", search: "test" }, "zh"),
    ).rejects.toThrow("redirect:/cimac/finance?q=test");
  });
  it("resolves an asset-only bookmark without reading financial history", async () => {
    await expect(redirectLegacyCimac("units", { unit: id(4) }, "fr")).rejects.toThrow(
      `redirect:/fr/cimac/assets/${id(4)}`,
    );
    expect(calls).not.toContain("payments");
  });
  it("resolves bare contracts and preserves historical sale type", async () => {
    await expect(redirectLegacyCimac("leases", { contract: id(6) }, "zh")).rejects.toThrow(
      `/cimac/contracts?contract=${id(6)}`,
    );
    await expect(redirectLegacyCimac("sales", { contract: id(7) }, "zh")).rejects.toThrow(
      `/cimac/contracts/history/sales/${id(7)}`,
    );
  });
  it("canonicalizes an old building code to the immutable building ID", async () => {
    await expect(redirectLegacyCimac("units", { building: "CIMAC-B01" }, "zh")).rejects.toThrow(
      `/cimac/assets?building=${id(2)}`,
    );
  });
  it("does not redirect an explicitly SACSI asset", async () => {
    await redirectLegacyCimac("units", { unit: id(5), project: id(9) }, "zh");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it.each([
    { project: "CIMAC", building: id(3) },
    { project: id(9), unit: id(4) },
    { project: "CIMAC", unit: id(4), building: id(3) },
    { project: "CIMAC", projectId: id(9) },
  ])("rejects contradictory project facts without redirecting %j", async (params) => {
    await expect(redirectLegacyCimac("units", params, "zh")).rejects.toThrow(
      "BusinessWorkspaceScopeUnavailable",
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("does not manufacture a park scope when RLS hides the project", async () => {
    tables.projects = [];
    await redirectLegacyCimac("customers", { project: "CIMAC" }, "zh");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("fails unavailable, not as a successful empty or broadened scope", async () => {
    fail = "units";
    await expect(redirectLegacyCimac("units", { unit: id(4) }, "zh")).rejects.toThrow(
      "BusinessWorkspaceScopeUnavailable",
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
