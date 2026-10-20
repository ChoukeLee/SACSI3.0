import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const deps = vi.hoisted(() => ({ client: { rpc: vi.fn() }, read: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => deps.client }));
vi.mock("@/features/contracts/workspace-service", () => ({ readWorkspace: deps.read }));
import { readLeaseCollectionContext } from "@/features/leases/lease-collection-read";
import { workspaceFixture, workspaceContract } from "./fixtures/contract-workspace";
import { parseWorkspaceQuery } from "@/features/contracts/workspace-model";

function fixture() {
  return workspaceFixture({}, parseWorkspaceQuery({ status: "all", locale: "zh" }), "detail");
}
beforeEach(() => {
  vi.clearAllMocks();
  deps.read.mockResolvedValue(fixture());
  deps.client.rpc.mockResolvedValue({
    error: { code: "P0001", message: "leaseCollectionNotFound" },
  });
});

it("reads fresh complete detail for the exact contract, not a list or remembered building", async () => {
  const data = await readLeaseCollectionContext(workspaceContract, "fr");
  expect(deps.read).toHaveBeenCalledWith(
    deps.client,
    "lease",
    expect.objectContaining({ status: "all", locale: "fr", projectId: "", buildingId: "" }),
    "detail",
    workspaceContract,
  );
  expect(data.contract.id).toBe(workspaceContract);
  expect(data.unit.id).toBe(data.contract.unit_id);
  expect(data.customer.id).toBe(data.contract.customer_id);
  expect(data.writeReady).toBe(true);
});
it("leaves a production-backed local preview read-only until its atomic endpoints are installed", async () => {
  deps.client.rpc.mockResolvedValue({ error: { code: "PGRST202", message: "RPC unavailable" } });
  const data = await readLeaseCollectionContext(workspaceContract, "zh");
  expect(data.writeReady).toBe(false);
  expect(data.contract.id).toBe(workspaceContract);
});
it("a failed capability read never enables submission or hides the real contract", async () => {
  deps.client.rpc.mockRejectedValue(new Error("offline"));
  const data = await readLeaseCollectionContext(workspaceContract, "zh");
  expect(data.writeReady).toBe(false);
  expect(data.receivables).toHaveLength(1);
});
it("rejects malformed contract IDs before contacting data services", async () => {
  await expect(readLeaseCollectionContext("308", "zh")).rejects.toThrow();
  expect(deps.read).not.toHaveBeenCalled();
});
it.each(["contract", "unit", "customer", "building", "truncated", "foreign"])(
  "fails closed on missing or inconsistent %s",
  async (kind) => {
    const data = fixture();
    if (kind === "contract") data.contracts = [];
    if (kind === "unit") data.units = [];
    if (kind === "customer") data.customers = [];
    if (kind === "building") data.buildings = [];
    if (kind === "truncated") data.receivableCount += 1;
    if (kind === "foreign") data.receivables[0].source_id = "99999999-9999-4999-8999-999999999999";
    deps.read.mockResolvedValue(data);
    await expect(readLeaseCollectionContext(workspaceContract, "zh")).rejects.toThrow();
  },
);
it("does not replace a failed database read with empty or zero-balance context", async () => {
  deps.read.mockRejectedValue(new Error("offline"));
  await expect(readLeaseCollectionContext(workspaceContract, "zh")).rejects.toThrow("offline");
});
