import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import {
  FinanceRecordContextReadError,
  readFinanceRecordContext,
} from "@/features/finance/finance-record-context-read";

const ids = {
  entry: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  unit: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  building: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  project: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  payment: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  contract: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  customer: "11111111-1111-4111-8111-111111111111",
  otherUnit: "22222222-2222-4222-8222-222222222222",
  otherBuilding: "33333333-3333-4333-8333-333333333333",
};
type Row = Record<string, unknown>;
let data: Record<string, Row[]>;
let errors: Record<string, { code?: string; message?: string }>;
let calls: { table: string; id: string; columns: string }[];
const client = {
  from(table: string) {
    return {
      select(columns: string) {
        return {
          eq(key: string, id: string) {
            expect(key).toBe("id");
            calls.push({ table, id, columns });
            return {
              maybeSingle: async () => ({
                data: data[table]?.find((row) => row.id === id) ?? null,
                error: errors[table] ?? null,
              }),
            };
          },
        };
      },
    };
  },
} as unknown as Pick<SupabaseClient, "from">;
const query = { kind: "ledger" as const, id: ids.entry };
beforeEach(() => {
  calls = [];
  errors = {};
  data = {
    ledger_entries: [
      {
        id: ids.entry,
        building_id: ids.building,
        unit_id: ids.unit,
        payment_id: ids.payment,
        entry_date: "2026-10-15",
        direction: "liability_in",
        category: "lease_deposit",
        amount_xof: "5000.00",
        description: null,
      },
    ],
    receivables: [
      {
        id: ids.entry,
        building_id: ids.building,
        unit_id: ids.unit,
        customer_id: ids.customer,
        source_type: "lease_contract",
        source_id: ids.contract,
        category: "lease_rent",
        title: "明确账期",
        due_date: "2026-10-01",
        amount_xof: "5000",
        paid_amount_xof: "3000",
        status: "partial",
        management_status: "managed",
        service_period_start: "2026-10-01",
        service_period_end: "2026-10-31",
        service_period_source: "原合同账期",
      },
    ],
    units: [
      { id: ids.unit, unit_no: "408", building_id: ids.building },
      { id: ids.otherUnit, unit_no: "不相关房间", building_id: ids.otherBuilding },
    ],
    buildings: [{ id: ids.building, display_name: "4#公寓", project_id: ids.project }],
    payments: [
      {
        id: ids.payment,
        unit_id: ids.unit,
        customer_id: ids.customer,
        source_type: "lease_deposit",
        source_id: ids.contract,
        payment_method: "offset",
        payment_date: "2026-09-30",
      },
    ],
    lease_contracts: [
      { id: ids.contract, unit_id: ids.unit, customer_id: ids.customer, contract_no: "L-OLD" },
    ],
    sale_contracts: [],
    daily_bookings: [],
    customers: [{ id: ids.customer, name: "历史合同客户" }],
  };
});
describe("selected finance record read", () => {
  it("reads exact IDs, retains ledger date and liabilities, never calls RPC or scans all pages", async () => {
    const result = await readFinanceRecordContext(client, query);
    expect(result).toMatchObject({
      amountXof: 5000,
      date: "2026-10-15",
      direction: "liability_in",
      paymentMethod: "offset",
      period: null,
      customer: { label: "历史合同客户" },
      source: {
        type: "lease_contract",
        id: ids.contract,
        href: `/leases?project=${ids.project}`,
        linkKind: "workspace",
      },
    });
    expect(calls).toHaveLength(6);
    expect(calls.every((call) => call.id && call.columns !== "*")).toBe(true);
    expect(calls.filter((call) => call.table === "lease_contracts")).toEqual([
      { table: "lease_contracts", id: ids.contract, columns: "id,unit_id,customer_id,contract_no" },
    ]);
  });
  it("preserves explicit receivable period and due date without selecting an arbitrary allocated payment", async () => {
    const result = await readFinanceRecordContext(client, { kind: "receivables", id: ids.entry });
    expect(result).toMatchObject({
      date: "2026-10-01",
      paidAmountXof: 3000,
      status: "partial",
      managementStatus: "managed",
      paymentId: null,
      paymentMethod: null,
      period: { start: "2026-10-01", end: "2026-10-31", source: "原合同账期" },
    });
    expect(calls.some((call) => call.table === "payments")).toBe(false);
  });
  it("keeps a confirmed end-only period and does not use due date as inferred start", async () => {
    data.receivables[0].service_period_start = null;
    expect(
      (await readFinanceRecordContext(client, { kind: "receivables", id: ids.entry })).period
        ?.start,
    ).toBeNull();
  });
  it("returns 404 for an invisible principal record", async () => {
    data.ledger_entries = [];
    await expect(readFinanceRecordContext(client, query)).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(1);
  });
  it("keeps a readable principal but makes an RLS-hidden exact association unknown", async () => {
    data.lease_contracts = [];
    const result = await readFinanceRecordContext(client, query);
    expect(result.amountXof).toBe(5000);
    expect(result.source).toBeNull();
    expect(result.customer).toBeNull();
    expect(calls.some((call) => call.table === "customers")).toBe(false);
  });
  it("does not substitute the current room occupant or unrelated payment source", async () => {
    data.lease_contracts[0].unit_id = ids.otherUnit;
    const result = await readFinanceRecordContext(client, query);
    expect(result.source).toBeNull();
    expect(result.customer).toBeNull();
    expect(calls.some((call) => call.table === "customers")).toBe(false);
  });
  it.each([
    ["ledger", "lease_contract"],
    ["ledger", "sale_contract"],
    ["receivables", "lease_contract"],
    ["receivables", "sale_contract"],
  ] as const)(
    "keeps an explicit historical %s customer from being replaced by the current %s customer",
    async (kind, sourceType) => {
      const changedCustomer = "44444444-4444-4444-8444-444444444444";
      const contract = { ...data.lease_contracts[0], customer_id: changedCustomer };
      if (sourceType === "sale_contract") data.sale_contracts = [contract];
      else data.lease_contracts = [contract];
      data.payments[0].source_type = sourceType;
      data.receivables[0].source_type = sourceType;
      data.customers.push({ id: changedCustomer, name: "合同后续修改的客户，不应覆盖旧账" });
      const result = await readFinanceRecordContext(client, { kind, id: ids.entry });
      expect(result.customer).toBeNull();
      expect(result.source).toBeNull();
      expect(result.amountXof).toBe(5000);
      expect(calls.some((call) => call.table === "customers")).toBe(false);
    },
  );
  it.each([
    ["ledger", "lease_contract"],
    ["ledger", "sale_contract"],
    ["receivables", "lease_contract"],
    ["receivables", "sale_contract"],
  ] as const)(
    "allows %s customer evidence from an exact %s when the financial customer is missing",
    async (kind, sourceType) => {
      data.payments[0].customer_id = null;
      data.receivables[0].customer_id = null;
      data.payments[0].source_type = sourceType;
      data.receivables[0].source_type = sourceType;
      if (sourceType === "sale_contract") data.sale_contracts = [data.lease_contracts[0]];
      const result = await readFinanceRecordContext(client, { kind, id: ids.entry });
      expect(result.customer).toEqual({ id: ids.customer, label: "历史合同客户" });
      expect(result.source?.type).toBe(sourceType);
    },
  );
  it("will not expose linked payment metadata from a different explicit unit", async () => {
    data.payments[0].unit_id = ids.otherUnit;
    const result = await readFinanceRecordContext(client, query);
    expect(result.source).toBeNull();
    expect(result.paymentMethod).toBeNull();
    expect(calls.some((call) => call.table === "lease_contracts")).toBe(false);
  });
  it("does not infer a project or contract for a global row with no explicit authorized location", async () => {
    data.ledger_entries[0].unit_id = null;
    data.ledger_entries[0].building_id = null;
    const result = await readFinanceRecordContext(client, query);
    expect(result.building).toBeNull();
    expect(result.source).toBeNull();
    expect(result.customer).toBeNull();
    expect(calls).toHaveLength(1);
  });
  it("does not expose a unit label or derive customer context when its building is not visible", async () => {
    data.buildings = [];
    const result = await readFinanceRecordContext(client, query);
    expect(result.building).toBeNull();
    expect(result.unit).toBeNull();
    expect(result.customer).toBeNull();
    expect(result.source).toBeNull();
    expect(calls.some((call) => call.table === "payments")).toBe(false);
  });
  it("retains a building-only manual payment method only for its two-way explicit ledger identity", async () => {
    data.ledger_entries[0].unit_id = null;
    data.payments[0].unit_id = null;
    data.payments[0].source_type = "manual";
    data.payments[0].source_id = ids.entry;
    expect((await readFinanceRecordContext(client, query)).paymentMethod).toBe("offset");
    data.payments[0].source_id = ids.contract;
    expect((await readFinanceRecordContext(client, query)).paymentMethod).toBeNull();
  });
  it("uses exact contract unit evidence for a building-level entry, never another building", async () => {
    data.ledger_entries[0].unit_id = null;
    expect((await readFinanceRecordContext(client, query)).source?.id).toBe(ids.contract);
    data.payments[0].unit_id = ids.otherUnit;
    data.lease_contracts[0].unit_id = ids.otherUnit;
    expect((await readFinanceRecordContext(client, query)).source).toBeNull();
  });
  it("does not invent a customer from a manually recorded receivable", async () => {
    data.receivables[0].source_type = "manual";
    data.receivables[0].source_id = null;
    data.receivables[0].customer_id = ids.customer;
    const result = await readFinanceRecordContext(client, { kind: "receivables", id: ids.entry });
    expect(result.customer).toBeNull();
    expect(result.source).toBeNull();
  });
  it("does not mistake daily booking agent for the historical guest", async () => {
    data.payments[0].source_type = "daily_booking";
    data.daily_bookings = [
      { id: ids.contract, unit_id: ids.unit, customer_id: ids.customer, guest_customer_id: null },
    ];
    const result = await readFinanceRecordContext(client, query);
    expect(result.customer).toBeNull();
    expect(result.source).toMatchObject({ type: "daily_booking", href: null });
  });
  it("does not treat a daily booking agent and explicit guest difference as a customer conflict", async () => {
    const guestId = "44444444-4444-4444-8444-444444444444";
    data.payments[0].source_type = "daily_booking";
    data.daily_bookings = [
      {
        id: ids.contract,
        unit_id: ids.unit,
        customer_id: ids.customer,
        guest_customer_id: guestId,
      },
    ];
    data.customers.push({ id: guestId, name: "明确登记的日租住客" });
    const result = await readFinanceRecordContext(client, query);
    expect(result.customer).toEqual({ id: guestId, label: "明确登记的日租住客" });
    expect(result.source?.type).toBe("daily_booking");
  });
  it("resolves generic property fees only by a unique explicit contract UUID", async () => {
    data.payments[0].source_type = "property_fee";
    expect((await readFinanceRecordContext(client, query)).source?.type).toBe("lease_contract");
    data.sale_contracts = [{ ...data.lease_contracts[0], contract_no: "S-OLD" }];
    const ambiguous = await readFinanceRecordContext(client, query);
    expect(ambiguous.source).toBeNull();
    expect(ambiguous.customer).toBeNull();
  });
  it.each(["ledger_entries", "units", "buildings", "payments", "lease_contracts", "customers"])(
    "does not swallow failed %s lookup as empty success",
    async (table) => {
      errors[table] = { message: "private SQL detail" };
      await expect(readFinanceRecordContext(client, query)).rejects.toBeInstanceOf(
        FinanceRecordContextReadError,
      );
      await expect(readFinanceRecordContext(client, query)).rejects.toMatchObject({ status: 503 });
    },
  );
  it("keeps explicit permission failure distinct from not found", async () => {
    errors.ledger_entries = { code: "42501" };
    await expect(readFinanceRecordContext(client, query)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects corrupt numeric values rather than converting unknown to zero", async () => {
    data.ledger_entries[0].amount_xof = null;
    await expect(readFinanceRecordContext(client, query)).rejects.toMatchObject({ status: 503 });
  });
});
