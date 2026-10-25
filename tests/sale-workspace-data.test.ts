import { beforeEach, expect, it, vi } from "vitest";
import { parseWorkspaceQuery } from "@/features/contracts/workspace-model";
import { saleFixture } from "./fixtures/sale-workbench";
import {
  workspaceBuilding,
  workspaceContract,
  workspaceProject,
  workspaceUnit,
} from "./fixtures/contract-workspace";
const mock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  fail: false,
  linkedBuilding: "",
  missingContract: false,
  lookupError: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { loadSaleWorkspace } from "@/features/sales/sale-workspace-data";
const cimac = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  cimacBuilding = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
beforeEach(() => {
  vi.clearAllMocks();
  mock.fail = false;
  mock.linkedBuilding = workspaceBuilding;
  mock.missingContract = false;
  mock.lookupError = false;
  mock.from.mockImplementation((table: string) =>
    table === "buildings"
      ? {
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
        }
      : {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  table === "sale_contracts"
                    ? mock.missingContract
                      ? null
                      : { unit_id: workspaceUnit }
                    : { building_id: mock.linkedBuilding },
                error: mock.lookupError ? { message: "unavailable" } : null,
              }),
            }),
          }),
        },
  );
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
  expect(data.buildings.map((building) => building.project?.code)).toEqual(["SACSI"]);
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
it("resolves a bare contract deep link to its actual unit/project instead of using an unscoped read", async () => {
  const data = await loadSaleWorkspace("zh", { contract: workspaceContract });
  expect(data.workspace?.query).toMatchObject({
    projectId: workspaceProject,
    buildingId: workspaceBuilding,
  });
  expect(data.initialProject).toBe(workspaceProject);
  expect(mock.from).toHaveBeenCalledWith("sale_contracts");
  expect(mock.from).toHaveBeenCalledWith("units");
  expect(mock.rpc).toHaveBeenCalledTimes(1);
});
it("locates a bare permalink outside the default building without dropping the explicit read perimeter", async () => {
  const actualBuildingId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  mock.linkedBuilding = actualBuildingId;
  const defaultFrom = mock.from.getMockImplementation()!;
  mock.from.mockImplementation((table: string) => {
    if (table !== "buildings") return defaultFrom(table);
    const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockResolvedValue({
      error: null,
      data: [
        {
          id: workspaceBuilding,
          code: "SACSI11",
          display_name: "Default",
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
          id: actualBuildingId,
          code: "SACSI4",
          display_name: "Actual",
          project_id: workspaceProject,
          project: {
            id: workspaceProject,
            code: "SACSI",
            display_name: "SACSI",
            allows_sale: true,
            is_active: true,
          },
        },
      ],
    });
    return chain;
  });
  const data = await loadSaleWorkspace("zh", { contract: workspaceContract });
  expect(data.workspace?.query).toMatchObject({
    projectId: workspaceProject,
    buildingId: actualBuildingId,
  });
  expect(mock.rpc).toHaveBeenCalledTimes(1);
});
it("keeps CIMAC out of the legacy sale loader; the route redirects its history to the park archive", async () => {
  await expect(loadSaleWorkspace("zh", { project: "CIMAC" })).rejects.toThrow();
  expect(mock.rpc).not.toHaveBeenCalled();
});
it.each(["foreign", "missing", "unavailable"])(
  "does not replace a %s contract permalink with a default building",
  async (kind) => {
    if (kind === "foreign") mock.linkedBuilding = cimacBuilding;
    if (kind === "missing") mock.missingContract = true;
    if (kind === "unavailable") mock.lookupError = true;
    await expect(loadSaleWorkspace("zh", { contract: workspaceContract })).rejects.toThrow();
    expect(mock.rpc).not.toHaveBeenCalled();
  },
);
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
