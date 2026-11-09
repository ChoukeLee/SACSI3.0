import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { readWorkspace } from "@/features/contracts/workspace-service";
import { parseWorkspaceQuery } from "@/features/contracts/workspace-model";
import { leaseTenantDisplayName } from "@/features/leases/lease-display-model";
import {
  workspaceFixture,
  workspaceContract,
  workspaceUnit,
  workspaceBuilding,
  workspaceCustomer,
  workspaceProject,
} from "./fixtures/contract-workspace";

const query = parseWorkspaceQuery({
  projectId: workspaceProject,
  status: "all",
  search: "",
  page: 1,
});
const bill = (index: number) => ({
  id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
  source_type: "lease_contract",
  source_id: workspaceContract,
  unit_id: workspaceUnit,
  building_id: workspaceBuilding,
  customer_id: workspaceCustomer,
  category: "lease_rent",
  currency: "USD",
  amount_xof: 0,
  paid_amount_xof: 0,
  amount_native: 3200,
  paid_amount_native: 0,
  due_date: "2026-11-22",
  status: "pending",
  management_status: "managed",
});
beforeEach(() => vi.clearAllMocks());

function client(rows = Array.from({ length: 1001 }, (_, index) => bill(index))) {
  const chain = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), range: vi.fn() };
  for (const key of ["select", "eq", "in", "order"] as const) chain[key].mockReturnValue(chain);
  chain.range.mockImplementation(async (from: number, to: number) => ({
    data: rows.slice(from, to + 1),
    count: rows.length,
    error: null,
  }));
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: workspaceFixture({}, query, "context"), error: null });
  return { from: vi.fn(() => chain), rpc, chain };
}

it("reads all scoped room bills in stable pages with original currency and no truncation", async () => {
  const db = client();
  const result = await readWorkspace(
    db as never,
    "lease",
    query,
    "context",
    undefined,
    undefined,
    true,
  );
  expect(result.roomReceivables).toHaveLength(1001);
  expect(result.roomReceivables?.[0]).toMatchObject({ currency: "USD", amount_native: 3200 });
  expect(db.from).toHaveBeenCalledWith("receivables");
  expect(db.chain.eq).toHaveBeenCalledWith("source_type", "lease_contract");
  expect(db.chain.in).toHaveBeenCalledWith("source_id", [workspaceContract]);
  expect(db.chain.range.mock.calls).toEqual([
    [0, 999],
    [1000, 1999],
  ]);
});

it("rejects a failed, mismatched or duplicate bill read instead of returning an empty success", async () => {
  for (const rows of [
    [{ ...bill(1), source_id: "88888888-8888-4888-8888-888888888888" }],
    [bill(1), bill(1)],
    [{ ...bill(1), building_id: "other" }],
  ]) {
    await expect(
      readWorkspace(client(rows) as never, "lease", query, "context", undefined, undefined, true),
    ).rejects.toThrow("ContractWorkspaceUnavailable");
  }
  const db = client();
  db.chain.range.mockResolvedValue({
    data: null,
    count: null,
    error: { message: "read unavailable" },
  });
  await expect(
    readWorkspace(db as never, "lease", query, "context", undefined, undefined, true),
  ).rejects.toThrow("ContractWorkspaceUnavailable");
});

it("leaves ordinary list reads on the existing RPC and does not add a broad table read", async () => {
  const db = client();
  db.rpc.mockResolvedValue({ data: workspaceFixture({}, query, "list"), error: null });
  const result = await readWorkspace(db as never, "lease", query, "list");
  expect(result.roomReceivables).toBeUndefined();
  expect(db.from).not.toHaveBeenCalled();
});

it("keeps ordinary form context free of room billing reads", async () => {
  const db = client();
  const result = await readWorkspace(db as never, "lease", query, "context");
  expect(result.roomReceivables).toBeUndefined();
  expect(db.from).not.toHaveBeenCalled();
});

it("projects the confirmed 511 tenant label from its own lease while preserving source identity", async () => {
  const db = client([]);
  const source = workspaceFixture({}, query, "context");
  source.buildings[0].code = "SACSI4";
  source.units[0].unit_no = "511";
  source.customers[0].name = "林荣俤2";
  db.rpc.mockResolvedValue({ data: source, error: null });

  const result = await readWorkspace(db as never, "lease", query, "context");
  expect(leaseTenantDisplayName(result.units[0], result.customers[0].name)).toBe("林荣俤");
  expect(leaseTenantDisplayName(result.units[0], "其他租客")).toBe("其他租客");
  expect(result.customers[0]).toMatchObject({ id: workspaceCustomer, name: "林荣俤2" });
  expect(result.contracts[0]).toMatchObject({
    customer_id: workspaceCustomer,
    unit_id: workspaceUnit,
  });

  source.units[0].unit_no = "512";
  const unrelated = await readWorkspace(db as never, "lease", query, "context");
  expect(unrelated.units[0].leaseTenantDisplay).toBeUndefined();
});
