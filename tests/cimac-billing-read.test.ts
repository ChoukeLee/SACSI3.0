import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { decodeCimacCustomerAccount, cimacReadMinor } from "@/features/finance/cimac-billing-model";
import { readCimacCustomerAccount } from "@/features/finance/cimac-billing-read";
import { parseCimacBillingQuery } from "@/features/finance/cimac-billing-query";

const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  customer = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  unit = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  contract = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  receivable = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
function empty() {
  return {
    project: { id: project, code: "CIMAC", display_name: "CIMAC" },
    canWrite: false,
    complete: true,
    customerPage: { rows: [], total: 0, page: 1, pageSize: 50 },
    selectedCustomerId: null,
    customer: null,
    units: [],
    contracts: [],
    receivables: [],
    payments: [],
    allocations: [],
    feeTerms: [],
    meterReadings: [],
  };
}
function account() {
  const summary = {
    id: customer,
    name: "Synthetic customer",
    phone: null,
    unitCount: 1,
    contractCount: 1,
    pendingCount: 0,
    balances: [
      {
        currency: "XOF",
        receivable: "100.00",
        paid: "20.00",
        outstanding: "80.00",
        overdue: "0.00",
      },
    ],
  };
  return {
    ...empty(),
    customerPage: { rows: [summary], total: 1, page: 1, pageSize: 50 },
    selectedCustomerId: customer,
    customer: summary,
    units: [
      {
        id: unit,
        building_id: project,
        unit_no: "T01",
        code: "TEST-T01",
        kind: "storefront",
        building_label: "Synthetic",
        building_code: "TEST",
        area_sqm: null,
      },
    ],
    contracts: [
      {
        id: contract,
        unitId: unit,
        customerId: customer,
        contractNo: "TEST",
        status: "draft",
        kind: "lease",
        data: { id: contract, customer_id: customer, unit_id: unit },
      },
    ],
    receivables: [
      {
        id: receivable,
        customer_id: customer,
        unit_id: unit,
        source_id: contract,
        source_type: "lease_contract",
        category: "property_fee",
        title: "Synthetic",
        due_date: "2027-04-01",
        updated_at: "2026-10-24T00:00:00Z",
        currency: "XOF",
        amount_xof: 100,
        paid_amount_xof: 20,
        outstanding: "80.00",
        collectible: true,
        status: "partial",
        management_status: "managed",
        service_period_start: null,
        service_period_end: null,
      },
    ],
  };
}
describe("complete authorized CIMAC account read", () => {
  it("accepts a genuine empty scope without synthesizing a customer or debt", () => {
    expect(decodeCimacCustomerAccount(empty()).customer).toBeNull();
  });
  it("retains unknown historical service periods without copying the due date", () => {
    const read = decodeCimacCustomerAccount(account(), customer);
    expect(read.receivables[0].service_period_start).toBeNull();
    expect(read.receivables[0].outstanding).toBe("80.00");
  });
  it.each([null, undefined, "", "NaN", "Infinity", "1e2", "0.001", -1])(
    "does not treat invalid amount %s as zero",
    (value) => {
      expect(() => cimacReadMinor(value)).toThrow("CimacAccountUnavailable");
    },
  );
  it("uses exact decimals rather than floating point addition", () => {
    expect(cimacReadMinor("0.10") + cimacReadMinor("0.20")).toBe(cimacReadMinor("0.30"));
  });
  it("requires the exact requested customer, not the first directory match", () => {
    expect(() => decodeCimacCustomerAccount(account(), unit)).toThrow();
  });
  it.each([
    (x: ReturnType<typeof account>) => {
      x.complete = false;
    },
    (x: ReturnType<typeof account>) => {
      x.customerPage.pageSize = 100;
    },
    (x: ReturnType<typeof account>) => {
      x.customer.balances[0].outstanding = "79.00";
    },
    (x: ReturnType<typeof account>) => {
      x.receivables[0].outstanding = "79.00";
    },
    (x: ReturnType<typeof account>) => {
      x.receivables[0].management_status = "historical_pending";
    },
    (x: ReturnType<typeof account>) => {
      x.receivables[0].category = "lease_deposit";
    },
    (x: ReturnType<typeof account>) => {
      x.receivables[0].customer_id = unit;
    },
    (x: ReturnType<typeof account>) => {
      x.receivables[0].updated_at = "not-a-date";
    },
  ])("rejects incomplete or inconsistent material facts", (mutate) => {
    const fixture = account();
    mutate(fixture);
    expect(() => decodeCimacCustomerAccount(fixture)).toThrow("CimacAccountUnavailable");
  });
  it("keeps native balances in native slots, never in XOF totals", () => {
    const fixture = account();
    Object.assign(fixture.receivables[0], {
      currency: "USD",
      amount_xof: 0,
      paid_amount_xof: 0,
      amount_native: 100,
      paid_amount_native: 20,
      collectible: false,
    });
    fixture.customer.balances[0].currency = "USD";
    expect(decodeCimacCustomerAccount(fixture).customer?.balances[0].currency).toBe("USD");
    fixture.receivables[0].amount_xof = 100;
    expect(() => decodeCimacCustomerAccount(fixture)).toThrow();
  });
  it("preserves incomplete native historical rows for review without a collectible amount", () => {
    const fixture = account();
    Object.assign(fixture.receivables[0], {
      currency: "USD",
      amount_native: null,
      paid_amount_native: null,
      collectible: false,
    });
    fixture.customer.balances = [];
    const read = decodeCimacCustomerAccount(fixture);
    expect(read.receivables[0].reviewReason).toBe("native_amount_unknown");
    expect(read.receivables[0].collectible).toBe(false);
    expect(fixture.receivables[0]).not.toHaveProperty("reviewReason");
  });
  it("retains legacy over-allocation as a review issue instead of losing all customer history", () => {
    const fixture = account();
    Object.assign(fixture.receivables[0], {
      paid_amount_xof: 110,
      outstanding: "0",
      collectible: false,
    });
    fixture.customer.balances = [];
    expect(decodeCimacCustomerAccount(fixture).receivables[0].reviewReason).toBe(
      "historical_overallocation",
    );
  });
  it("keeps contradictory unit/building source facts visible but not collectible or an effective debt", () => {
    const fixture = account();
    const wrongBuilding = "99999999-9999-4999-8999-999999999999";
    Object.assign(fixture.receivables[0], { building_id: wrongBuilding });
    fixture.customer.balances = [];
    const read = decodeCimacCustomerAccount(fixture);
    expect(read.receivables[0]).toMatchObject({
      unit_id: unit,
      building_id: wrongBuilding,
      amount_xof: 100,
      paid_amount_xof: 20,
      outstanding: "80.00",
      reviewReason: "unit_building_mismatch",
      collectible: false,
    });
    expect(fixture.receivables[0].collectible).toBe(true);
    expect(fixture.receivables[0]).not.toHaveProperty("reviewReason");
  });
  it("does not label a legal building-only receivable or an unknown building as a unit/building mismatch", () => {
    for (const extra of [
      { unit_id: null, building_id: project },
      { unit_id: unit, building_id: project },
      { unit_id: unit, building_id: null },
    ]) {
      const fixture = account();
      Object.assign(fixture.receivables[0], { ...extra, collectible: false });
      const read = decodeCimacCustomerAccount(fixture);
      expect(read.receivables[0]).not.toHaveProperty("reviewReason");
      expect(read.receivables[0].unit_id).toBe(extra.unit_id);
      expect(read.receivables[0].building_id).toBe(extra.building_id);
    }
  });
  it("passes only the selected customer and bounded directory query to the session RPC", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: account(), error: null }) };
    const read = await readCimacCustomerAccount(
      client as never,
      parseCimacBillingQuery({ customerId: customer }),
    );
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("cimac_customer_account_rpc", {
      p_customer_id: customer,
      p_search: null,
      p_page: 1,
    });
    expect(read.complete).toBe(true);
  });
  it("does not replace transport failure with an empty account", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } }) };
    await expect(
      readCimacCustomerAccount(client as never, parseCimacBillingQuery({})),
    ).rejects.toThrow("CimacAccountUnavailable");
  });
});
