import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { readWorkspace } from "@/features/contracts/workspace-service";
import { decodeWorkspace, parseWorkspaceQuery } from "@/features/contracts/workspace-model";
import { saleFixture } from "./fixtures/sale-workbench";
import {
  workspaceBuilding,
  workspaceContract,
  workspaceCustomer,
  workspaceProject,
  workspaceUnit,
} from "./fixtures/contract-workspace";

const q = parseWorkspaceQuery({ projectId: workspaceProject, status: "all" });
function db(total = 101) {
  const context = saleFixture(q, "context", total);
  context.scopeCount = total;
  context.stats.scopeCount = total;
  const rows = {
    receivables: Array.from({ length: 1001 }, (_, i) => ({
      id: `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`,
      source_type: "sale_contract",
      source_id: workspaceContract,
      unit_id: workspaceUnit,
      building_id: workspaceBuilding,
      customer_id: workspaceCustomer,
      category: "sale_installment",
      currency: "XOF",
      amount_xof: 100,
      paid_amount_xof: 0,
      amount_native: null,
      paid_amount_native: null,
      due_date: "2026-11-22",
      status: "pending",
      management_status: "managed",
    })),
    payments: Array.from({ length: 1001 }, (_, i) => ({
      id: `88888888-8888-4888-8888-${String(i).padStart(12, "0")}`,
      source_type: "sale_contract",
      source_id: workspaceContract,
      unit_id: workspaceUnit,
      customer_id: workspaceCustomer,
      currency: "CNY",
      amount: 10,
      exchange_rate_to_xof: 80,
      native_settlement: false,
      payment_method: "bank_transfer",
      payment_date: "2026-11-01",
      request_kind: null,
      reversal_of_payment_id: null,
    })),
    sale_payment_schedule: Array.from({ length: 1001 }, (_, i) => ({
      id: `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`,
      sale_contract_id: workspaceContract,
      installment_no: i + 1,
      amount_xof: 100,
      due_date: "2026-11-22",
      status: "pending",
      receivable_id: `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`,
    })),
  };
  const calls: { table: string; filters: Record<string, unknown[]>; from: number; to: number }[] =
    [];
  const from = vi.fn((table: keyof typeof rows) => {
    const filters: Record<string, unknown[]> = {};
    const chain = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), range: vi.fn() };
    chain.select.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.eq.mockImplementation((key, value) => {
      filters[key] = [value];
      return chain;
    });
    chain.in.mockImplementation((key, value) => {
      filters[key] = value;
      return chain;
    });
    chain.range.mockImplementation(async (start: number, end: number) => {
      calls.push({ table, filters, from: start, to: end });
      const data = rows[table].filter((row) =>
        Object.entries(filters).every(([key, values]) =>
          values.includes((row as Record<string, unknown>)[key]),
        ),
      );
      return { data: data.slice(start, end + 1), count: data.length, error: null };
    });
    return chain;
  });
  return {
    rpc: vi.fn().mockResolvedValue({ data: context, error: null }),
    from,
    rows,
    calls,
    context,
  };
}
beforeEach(() => vi.clearAllMocks());
it("reads all three sale financial sources in stable scoped pages and contract batches", async () => {
  const client = db();
  const result = await readWorkspace(
    client as never,
    "sale",
    q,
    "context",
    undefined,
    undefined,
    true,
  );
  expect(result.contracts).toHaveLength(101);
  expect(result.roomPayments).toHaveLength(1001);
  expect(result.roomReceivables).toHaveLength(1001);
  expect(result.roomSchedules).toHaveLength(1001);
  expect(result.roomFinanceCounts).toEqual({ payments: 1001, receivables: 1001, schedules: 1001 });
  for (const table of ["payments", "receivables", "sale_payment_schedule"])
    expect(client.calls.filter((c) => c.table === table).map((c) => [c.from, c.to])).toContainEqual(
      [1000, 1999],
    );
  expect(
    client.calls.every((c) => (c.filters.source_id ?? c.filters.sale_contract_id).length <= 100),
  ).toBe(true);
});
it("never adds room financial queries to normal sale list or form context", async () => {
  for (const mode of ["context", "list"] as const) {
    const client = db(1);
    client.rpc.mockResolvedValue({ data: saleFixture(q, mode, 1), error: null });
    expect((await readWorkspace(client as never, "sale", q, mode)).roomPayments).toBeUndefined();
    expect(client.from).not.toHaveBeenCalled();
  }
});
it("fails closed on missing complete flags/counts or cross-scope evidence", async () => {
  const client = db(1),
    result = await readWorkspace(client as never, "sale", q, "context", undefined, undefined, true);
  for (const value of [
    { ...result, roomPayments: undefined },
    { ...result, roomFinanceCounts: { payments: 1, receivables: 1001, schedules: 1001 } },
    { ...result, roomSchedules: undefined },
  ])
    expect(() => decodeWorkspace(value, "sale", q, "context", undefined, true)).toThrow();
  client.rows.payments[0].source_id = "11111111-1111-4111-8111-111111111111";
  // Query fences exclude records that do not belong to the selected contract IDs.
  const scoped = await readWorkspace(
    client as never,
    "sale",
    q,
    "context",
    undefined,
    undefined,
    true,
  );
  expect(scoped.roomPayments).toHaveLength(1000);
});
it("requires the full unfiltered normalized scope for the supplemental context", async () => {
  for (const query of [
    { ...q, status: "current" },
    { ...q, search: "buyer" },
    { ...q, page: 2 },
  ])
    await expect(
      readWorkspace(db(1) as never, "sale", query, "context", undefined, undefined, true),
    ).rejects.toMatchObject({ status: 400 });
});
