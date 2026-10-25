import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { readCimacHistoricalSale } from "@/features/cimac/cimac-historical-sale-read";
import {
  workspaceFixture,
  workspaceProject,
  workspaceBuilding,
  workspaceContract,
  workspaceCustomer,
  workspaceUnit,
} from "./fixtures/contract-workspace";
const scope = {
  project: { id: workspaceProject, code: "CIMAC" as const, displayName: "Park" },
  buildings: [
    { id: workspaceBuilding, code: "B01", name: "Park", constructionStatus: null, isActive: true },
  ],
};
type Result = { data: unknown; count?: number | null; error: unknown };
let results: Record<string, Result>;
let calls: [string, string, unknown[]][];
const from = vi.fn((table: string) => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "range"])
    query[method] = (...args: unknown[]) => {
      calls.push([table, method, args]);
      return query;
    };
  query.maybeSingle = () => Promise.resolve(results[table]);
  query.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(results[table]).then(resolve, reject);
  return query;
});
const client = { from } as unknown as Pick<SupabaseClient, "from">;
beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  const data = workspaceFixture();
  results = {
    sale_contracts: {
      data: { ...data.contracts[0], total_amount_xof: 900, total_amount_confirmed: true },
      error: null,
    },
    units: { data: data.units[0], error: null },
    buildings: { data: { id: workspaceBuilding, project_id: workspaceProject }, error: null },
    customers: { data: data.customers[0], error: null },
    payments: {
      data: [
        {
          id: "receipt",
          source_id: workspaceContract,
          source_type: "sale",
          unit_id: workspaceUnit,
          customer_id: workspaceCustomer,
          amount: 120.5,
          currency: "USD",
          native_settlement: true,
        },
      ],
      count: 1,
      error: null,
    },
    receivables: { data: [], count: 0, error: null },
    sale_payment_schedule: { data: [], count: 0, error: null },
  };
});
it("reads an exact historical sale even when the park no longer allows new sales, without conversion or writes", async () => {
  const data = await readCimacHistoricalSale(client, scope, workspaceContract);
  expect(data.payments[0]).toMatchObject({
    amount: 120.5,
    currency: "USD",
    native_settlement: true,
  });
  expect(calls).toContainEqual(["buildings", "eq", ["project_id", workspaceProject]]);
  expect(calls).toContainEqual(["payments", "select", ["*", { count: "exact" }]]);
  expect(calls).toContainEqual(["payments", "eq", ["source_id", workspaceContract]]);
  expect(
    calls.some(([, method]) => ["insert", "update", "delete", "upsert"].includes(method)),
  ).toBe(false);
});
it("rejects malformed contract identifiers before a database query", async () => {
  await expect(readCimacHistoricalSale(client, scope, "302")).rejects.toMatchObject({
    status: 400,
  });
  expect(from).not.toHaveBeenCalled();
});
it.each(["unit", "building", "project"])(
  "rejects a foreign %s before reading customer or financial data",
  async (kind) => {
    if (kind === "unit") (results.units.data as Record<string, unknown>).building_id = "foreign";
    if (kind === "building") results.buildings.data = null;
    if (kind === "project")
      (results.buildings.data as Record<string, unknown>).project_id = "foreign";
    await expect(readCimacHistoricalSale(client, scope, workspaceContract)).rejects.toMatchObject({
      status: 403,
    });
    expect(from).not.toHaveBeenCalledWith("payments");
    expect(from).not.toHaveBeenCalledWith("customers");
  },
);
it.each(["payments", "receivables", "sale_payment_schedule"])(
  "refuses truncated or failed %s reads rather than showing an incomplete financial history",
  async (table) => {
    results[table].count = 5001;
    await expect(readCimacHistoricalSale(client, scope, workspaceContract)).rejects.toMatchObject({
      status: 503,
    });
    results[table].error = { message: "offline" };
    await expect(readCimacHistoricalSale(client, scope, workspaceContract)).rejects.toMatchObject({
      status: 503,
    });
  },
);
it.each(["source_id", "unit_id", "customer_id", "amount"])(
  "fails closed when a payment's %s contradicts the exact contract",
  async (field) => {
    (results.payments.data as Record<string, unknown>[])[0][field] =
      field === "amount" ? "not money" : "foreign";
    await expect(readCimacHistoricalSale(client, scope, workspaceContract)).rejects.toMatchObject({
      status: 503,
    });
  },
);
