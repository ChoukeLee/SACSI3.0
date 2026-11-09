import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { readWorkspace } from "@/features/contracts/workspace-service";
import { decodeWorkspace, type WorkspaceData } from "@/features/contracts/workspace-model";
import type { LedgerEntryRow, PaymentRow } from "@/types/database";
import {
  workspaceBuilding,
  workspaceContract,
  workspaceCustomer,
  workspaceFixture,
  workspaceUnit,
} from "./fixtures/contract-workspace";

const paymentId = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ledgerId = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function detail(count = 1) {
  const data = workspaceFixture({}, undefined, "detail");
  data.payments = Array.from({ length: count }, (_, n): PaymentRow => ({
    id: paymentId(n),
    source_type: "lease_contract",
    source_id: workspaceContract,
    unit_id: workspaceUnit,
    customer_id: workspaceCustomer,
    payment_date: "2026-10-15",
    amount: 100.25,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    payment_method: null,
    receipt_no: null,
    notes: null,
    request_kind: null,
    reversal_of_payment_id: null,
    created_at: "2026-10-15T12:00:00Z",
  }));
  data.paymentCount = count;
  return data;
}
function ledger(n = 0, payment = paymentId(0)): LedgerEntryRow {
  return {
    id: ledgerId(n),
    building_id: workspaceBuilding,
    unit_id: workspaceUnit,
    payment_id: payment,
    entry_date: "2026-10-15",
    direction: "income",
    category: "lease_rent",
    amount_xof: 100.25,
    currency: "XOF",
    amount_native: null,
    amount_cny: null,
    description: null,
    created_at: "2026-10-15T12:00:00Z",
  };
}
type Reply = {
  data: LedgerEntryRow[] | null;
  count: number | null;
  error: { message: string } | null;
};
function client(data = detail(), rows = [ledger()]) {
  const calls: { ids: string[]; start: number; end: number }[] = [];
  const page = vi.fn(async (ids: string[], start: number, end: number): Promise<Reply> => {
    calls.push({ ids, start, end });
    const matches = rows
      .filter((row) => ids.includes(row.payment_id!))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { data: matches.slice(start, end + 1), count: matches.length, error: null };
  });
  const select = vi.fn();
  const order = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === "buildings") {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: async () => ({ data: data.buildings, error: null }),
      };
      return chain;
    }
    expect(table).toBe("ledger_entries");
    let ids: string[] = [];
    const chain = {
      select: (columns: string, options: unknown) => {
        select(columns, options);
        return chain;
      },
      in: (key: string, batch: string[]) => {
        expect(key).toBe("payment_id");
        ids = batch;
        return chain;
      },
      order: (key: string) => {
        order(key);
        return chain;
      },
      range: (start: number, end: number) => page(ids, start, end),
    };
    return chain;
  });
  const rpc = vi.fn(async (name: string) =>
    name === "contract_workspace_read_rpc"
      ? { data: structuredClone(data), error: null }
      : { data: { contractId: workspaceContract, paymentCount: 0, payments: [] }, error: null },
  );
  return { rpc, from, page, select, order, calls };
}
const read = (db: ReturnType<typeof client>, data: WorkspaceData) =>
  readWorkspace(db as never, "lease", data.query, "detail", workspaceContract);

it("reads historical selected receipts in complete stable pages and bounded payment batches", async () => {
  const data = detail(101);
  data.contracts[0].status = "terminated";
  const rows = [
    ...data.payments.map((p, n) => ledger(n, p.id)),
    ...Array.from({ length: 1000 }, (_, n) => ledger(n + 101)),
  ];
  const db = client(data, rows);
  const result = await read(db, data);
  expect(result.leaseReceiptLedger).toHaveLength(1101);
  expect(result.contracts[0].id).toBe(workspaceContract);
  expect(result.contracts[0].status).toBe("terminated");
  expect(db.calls.some((call) => call.start === 1000 && call.end === 1999)).toBe(true);
  expect(db.calls.every((call) => call.ids.length <= 100)).toBe(true);
  expect(db.order.mock.calls.every(([key]) => key === "id")).toBe(true);
  expect(db.select).toHaveBeenCalledWith(expect.stringContaining("payment_id,entry_date"), {
    count: "exact",
  });
  expect(db.from.mock.calls.every(([table]) => table === "ledger_entries")).toBe(true);
});

it("only adds evidence reads for selected SACSI legacy receipts, preserving existing CIMAC projection", async () => {
  const data = detail();
  data.payments[0].source_type = "lease_rent";
  const db = client(data);
  expect((await read(db, data)).leaseReceiptLedger).toBeUndefined();
  expect(db.from).not.toHaveBeenCalled();
  const cimac = detail();
  cimac.buildings[0].project!.code = "CIMAC";
  const park = client(cimac);
  const result = await readWorkspace(
    park as never,
    "lease",
    cimac.query,
    "detail",
    workspaceContract,
    "cimac",
  );
  expect(result.leaseReceiptLedger).toBeUndefined();
  expect(park.from.mock.calls.map(([table]) => table)).toEqual(["buildings"]);
  expect(park.rpc).toHaveBeenCalledWith("cimac_lease_collection_projection_rpc", {
    p_contract_id: workspaceContract,
  });
});

it("uses the validated explicit SACSI boundary when optional RPC project metadata is absent", async () => {
  const data = detail();
  Reflect.deleteProperty(data.buildings[0], "project");
  const db = client(data);
  const result = await readWorkspace(
    db as never,
    "lease",
    data.query,
    "detail",
    workspaceContract,
    "sacsi",
  );
  expect(db.from.mock.calls.map(([table]) => table)).toEqual(["buildings", "ledger_entries"]);
  expect(result.leaseReceiptLedger).toEqual([ledger()]);
  expect(
    decodeWorkspace(result, "lease", data.query, "detail", workspaceContract).leaseReceiptLedger,
  ).toEqual([ledger()]);
  const implicit = client(data);
  expect((await read(implicit, data)).leaseReceiptLedger).toBeUndefined();
  expect(implicit.from).not.toHaveBeenCalled();
  const foreign = structuredClone(result);
  foreign.buildings[0].project = {
    id: foreign.buildings[0].project_id!,
    code: "CIMAC",
    display_name: "Synthetic park",
  };
  expect(() =>
    decodeWorkspace(foreign, "lease", data.query, "detail", workspaceContract),
  ).toThrow();
  Reflect.deleteProperty(foreign.buildings[0], "project");
  foreign.buildings[0].project_id = workspaceCustomer;
  expect(() =>
    decodeWorkspace(foreign, "lease", data.query, "detail", workspaceContract),
  ).toThrow();
});

it.each(["list", "scope", "context"] as const)(
  "does not add ledger queries to %s reads",
  async (mode) => {
    const data = workspaceFixture({}, undefined, mode),
      db = client(data);
    const result = await readWorkspace(db as never, "lease", data.query, mode);
    expect(result.leaseReceiptLedger).toBeUndefined();
    expect(db.from).not.toHaveBeenCalled();
  },
);

it("keeps a successful empty evidence result distinct from unavailable evidence", async () => {
  const data = detail();
  expect((await read(client(data, []), data)).leaseReceiptLedger).toEqual([]);
  for (const reply of [
    { data: null, count: null, error: { message: "denied" } },
    { data: [], count: null, error: null },
    { data: [], count: 1, error: null },
  ]) {
    const db = client(data);
    db.page.mockResolvedValueOnce(reply);
    await expect(read(db, data)).rejects.toMatchObject({ status: 503 });
  }
  const db = client(data);
  await expect(
    readWorkspace({ rpc: db.rpc } as never, "lease", data.query, "detail", workspaceContract),
  ).rejects.toMatchObject({ status: 503 });
});

it("rejects an out-of-scope result and a duplicate row rather than returning partial proof", async () => {
  const data = detail();
  for (const rows of [
    [ledger(0, paymentId(999))],
    [{ ...ledger(), unit_id: paymentId(999) }],
    [{ ...ledger(), building_id: paymentId(999) }],
    [ledger(), ledger()],
  ]) {
    const db = client(data);
    db.page.mockResolvedValueOnce({ data: rows, count: rows.length, error: null });
    await expect(read(db, data)).rejects.toMatchObject({ status: 503 });
  }
});

it("decodes optional purpose evidence without coercing raw decimal or null values into zero", () => {
  const data = detail();
  expect(
    decodeWorkspace(data, "lease", data.query, "detail", workspaceContract).leaseReceiptLedger,
  ).toBeUndefined();
  const raw = {
    ...ledger(),
    amount_xof: "100.25",
    amount_native: null,
    unit_id: null,
    building_id: null,
  };
  const decoded = decodeWorkspace(
    { ...data, leaseReceiptLedger: [raw] },
    "lease",
    data.query,
    "detail",
    workspaceContract,
  );
  expect(decoded.leaseReceiptLedger?.[0]).toEqual(raw);
  const unknown = { ...raw, amount_xof: null, entry_date: null, currency: null };
  expect(
    decodeWorkspace(
      { ...data, leaseReceiptLedger: [unknown] },
      "lease",
      data.query,
      "detail",
      workspaceContract,
    ).leaseReceiptLedger?.[0],
  ).toEqual(unknown);
});

it("rejects malformed or unrelated evidence and evidence injected into non-detail payloads", () => {
  const data = detail();
  for (const patch of [
    { payment_id: paymentId(99) },
    { id: "bad" },
    { category: null },
    { direction: "refund" },
    { entry_date: "2026-02-30" },
    { amount_xof: " " },
    { amount_native: "Infinity" },
    { unit_id: undefined },
    { building_id: workspaceCustomer },
    { description: 1 },
    { currency: undefined },
  ])
    expect(() =>
      decodeWorkspace(
        { ...data, leaseReceiptLedger: [{ ...ledger(), ...patch }] },
        "lease",
        data.query,
        "detail",
        workspaceContract,
      ),
    ).toThrow();
  for (const mode of ["list", "scope", "context"] as const) {
    const other = workspaceFixture({}, data.query, mode);
    expect(() =>
      decodeWorkspace({ ...other, leaseReceiptLedger: [] }, "lease", other.query, mode),
    ).toThrow();
  }
  data.payments[0].source_type = "lease_rent";
  expect(() =>
    decodeWorkspace(
      { ...data, leaseReceiptLedger: [ledger()] },
      "lease",
      data.query,
      "detail",
      workspaceContract,
    ),
  ).toThrow();
});
