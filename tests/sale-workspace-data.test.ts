import { beforeEach, expect, it, vi } from "vitest";
import { parseWorkspaceQuery } from "@/features/contracts/workspace-model";
import { saleFixture } from "./fixtures/sale-workbench";
import {
  workspaceBuilding,
  workspaceContract,
  workspaceProject,
} from "./fixtures/contract-workspace";
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), fail: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { loadSaleWorkspace } from "@/features/sales/sale-workspace-data";
const cimac = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  cimacBuilding = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
beforeEach(() => {
  vi.clearAllMocks();
  mock.fail = false;
  mock.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: async () => ({
            error: mock.fail ? { message: "bad" } : null,
            data: mock.fail
              ? null
              : [
                  {
                    id: workspaceBuilding,
                    code: "SACSI11",
                    display_name: "Synthetic 11",
                    project_id: workspaceProject,
                    project: {
                      id: workspaceProject,
                      code: "SACSI",
                      display_name: "SACSI",
                      allows_sale: true,
                      is_active: true,
                    },
                  },
                  {
                    id: cimacBuilding,
                    code: "CIMAC",
                    display_name: "CIMAC",
                    project_id: cimac,
                    project: {
                      id: cimac,
                      code: "CIMAC",
                      display_name: "CIMAC",
                      allows_sale: false,
                      is_active: true,
                    },
                  },
                ],
          }),
        }),
      }),
    }),
  }));
  mock.rpc.mockImplementation(
    async (_name: string, input: { p_input: Record<string, unknown> }) => ({
      error: null,
      data: saleFixture(parseWorkspaceQuery(input.p_input)),
    }),
  );
});
it("reads only authorized building metadata and one established paginated read RPC", async () => {
  const data = await loadSaleWorkspace("zh");
  expect(mock.from).toHaveBeenCalledExactlyOnceWith("buildings");
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  expect(mock.rpc.mock.calls[0][0]).toBe("contract_workspace_read_rpc");
  expect(data.workspace?.query.buildingId).toBe(workspaceBuilding);
  expect(data.workspace?.payments).toEqual([]);
});
it("restores explicit permalink filters without an initial throwaway RPC", async () => {
  const data = await loadSaleWorkspace("fr", {
    project: workspaceProject,
    building: workspaceBuilding,
    q: "Synthetic",
    status: "all",
    page: "2",
    sort: "balance",
    direction: "desc",
    contract: workspaceContract,
  });
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  expect(data.workspace?.query).toMatchObject({
    projectId: workspaceProject,
    buildingId: workspaceBuilding,
    search: "Synthetic",
    status: "all",
    page: 2,
    sort: "balance",
    direction: "desc",
    locale: "fr",
  });
  expect(data.initialContract).toBe(workspaceContract);
});
it("does not restrict a contract deep link without explicit scope to the default building", async () => {
  const data = await loadSaleWorkspace("zh", { contract: workspaceContract });
  expect(data.workspace?.query.buildingId).toBe("");
  expect(mock.rpc).toHaveBeenCalledTimes(1);
});
it("renders the recognized no-sale project without querying sale contracts or showing fabricated totals", async () => {
  const data = await loadSaleWorkspace("zh", { project: "CIMAC" });
  expect(data.noSaleProject).toBe(true);
  expect(data.initialProject).toBe(cimac);
  expect(data.workspace).toBeUndefined();
  expect(mock.rpc).not.toHaveBeenCalled();
});
it.each([
  { project: workspaceProject, building: cimacBuilding },
  { building: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  { contract: "not-uuid" },
  { q: ["a", "b"] },
  { page: "0" },
])("fails closed for malformed or cross-project scope %j", async (params) => {
  await expect(loadSaleWorkspace("zh", params)).rejects.toThrow();
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("does not convert unavailable catalogs into an empty successful workspace", async () => {
  mock.fail = true;
  await expect(loadSaleWorkspace("zh")).rejects.toThrow("ContractWorkspaceUnavailable");
  expect(mock.rpc).not.toHaveBeenCalled();
});
