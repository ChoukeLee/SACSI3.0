import { expect, it } from "vitest";
import type { LeaseContractRow, ReceivableRow } from "@/types/database";
import {
  buildLeaseRecordOverview,
  buildLeaseRoomOverview,
  type LeaseRoomOverviewInput,
} from "./lease-room-overview-model";
import {
  workspaceFixture,
  workspaceBuilding,
  workspaceContract,
  workspaceCustomer,
  workspaceUnit,
} from "../../../tests/fixtures/contract-workspace";

const oldId = "99999999-9999-4999-8999-999999999999";
const oldCustomer = "88888888-8888-4888-8888-888888888888";

function input(): LeaseRoomOverviewInput {
  const data = workspaceFixture();
  const current = {
    ...(data.contracts[0] as LeaseContractRow),
    paid_through_date: "2027-12-31",
  };
  const old: LeaseContractRow = {
    ...current,
    id: oldId,
    customer_id: oldCustomer,
    status: "terminated",
    start_date: "2025-01-01",
    expected_end_date: "2026-09-30",
    actual_end_date: "2026-09-30",
    paid_through_date: "2025-12-31",
    rent_currency: "USD",
    monthly_rent_amount: 3200,
    monthly_rent_xof: 0,
  };
  return {
    units: data.units,
    buildings: data.buildings,
    customers: [...data.customers, { ...data.customers[0], id: oldCustomer, name: "Former user" }],
    contracts: [current, old],
    today: "2026-11-07",
    receivables: [],
  };
}

function bill(overrides: Partial<ReceivableRow> = {}): ReceivableRow {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    source_type: "lease_contract",
    source_id: oldId,
    unit_id: workspaceUnit,
    building_id: workspaceBuilding,
    customer_id: oldCustomer,
    category: "lease_rent",
    currency: "USD",
    amount_xof: 1280000,
    paid_amount_xof: 400000,
    amount_native: 3200,
    paid_amount_native: 1000,
    due_date: "2026-11-01",
    status: "partial",
    management_status: "managed",
    title: "Registered balance",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function former(data: LeaseRoomOverviewInput) {
  return buildLeaseRecordOverview(data).find((row) => row.id === oldId)!;
}

it("keeps each former tenant's native debt separate from the current tenant and room card", () => {
  const data = input();
  data.receivables = [bill()];
  const rows = buildLeaseRecordOverview(data);
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id === workspaceContract)).toMatchObject({
    historical: false,
    customer: { id: workspaceCustomer },
    attention: null,
  });
  expect(former(data)).toMatchObject({
    historical: true,
    customer: { id: oldCustomer },
    paidThrough: "2025-12-31",
    attention: { kind: "overdue", currency: "USD", amount: 2200, dueDate: "2026-11-01" },
  });
  expect(buildLeaseRoomOverview(data)[0]).toMatchObject({
    contract: { id: workspaceContract },
    customer: { id: workspaceCustomer },
    attention: null,
  });
});

it.each(["2026-11-07", "2026-11-08", "2027-03-01"])(
  "keeps a historical balance due %s as unsettled rather than a new-rent reminder",
  (dueDate) => {
    const data = input();
    data.receivables = [bill({ due_date: dueDate })];
    expect(former(data).attention).toMatchObject({
      kind: "unsettled",
      currency: "USD",
      amount: 2200,
      dueDate,
    });
  },
);

it.each(["paid", "partial", "overdue"] as const)(
  "does not turn a fully settled historical bill (%s) or old coverage date into debt",
  (status) => {
    const data = input();
    data.receivables = [bill({ paid_amount_native: 3200, status })];
    expect(former(data)).toMatchObject({ attention: null, balances: [] });
  },
);

it.each([undefined, []] as const)(
  "keeps history queryable without unpaid evidence when detailed bills are %s",
  (receivables) => {
    const data = input();
    data.receivables = receivables;
    expect(former(data)).toMatchObject({ historical: true, attention: null, balances: [] });
  },
);

it("keeps historical-pending balances for review without declaring a managed overdue amount", () => {
  const data = input();
  data.receivables = [bill({ management_status: "historical_pending" })];
  expect(former(data)).toMatchObject({
    attention: { kind: "coverage", amount: null, days: null },
    balances: [],
    reviewReasons: ["historical_balance_requires_review"],
  });
});

it("uses an unknown-native XOF shadow only as review evidence, never a debt valuation", () => {
  const data = input();
  data.receivables = [bill({ status: "pending", amount_native: null, paid_amount_native: null })];
  const row = former(data);
  expect(row.attention).toMatchObject({ kind: "coverage", amount: null, days: null });
  expect(row.attention?.currency).toBeUndefined();
  expect(row.balances).toEqual([]);
  data.receivables = [
    bill({
      status: "pending",
      amount_native: null,
      paid_amount_native: null,
      amount_xof: 0,
      paid_amount_xof: 0,
    }),
  ];
  expect(former(data)).toMatchObject({ attention: null, balances: [] });
  data.receivables = [
    bill({
      status: "partial",
      amount_native: null,
      paid_amount_native: null,
      amount_xof: 0,
      paid_amount_xof: 0,
    }),
  ];
  expect(former(data).attention?.kind).toBe("coverage");
});

it("excludes cancelled and excluded bills even when a legacy summary still has a balance", () => {
  const data = input();
  data.summaries = {
    [oldId]: {
      total: 100,
      paid: 0,
      outstanding: 100,
      overdue: 100,
      count: 1,
      nextDue: "2020-01-01",
    },
  };
  data.receivables = [
    bill({ status: "cancelled" }),
    bill({ id: "66666666-6666-4666-8666-666666666666", management_status: "excluded" }),
  ];
  expect(former(data)).toMatchObject({ attention: null, balances: [] });
});

it("preserves existing category and currency buckets without adding shadow XOF or mixing currencies", () => {
  const data = input();
  data.receivables = [
    bill(),
    bill({
      id: "66666666-6666-4666-8666-666666666666",
      category: "property_fee",
      currency: "XOF",
      amount_xof: 7500,
      paid_amount_xof: 0,
      amount_native: null,
      paid_amount_native: null,
    }),
    bill({
      id: "55555555-5555-4555-8555-555555555555",
      category: "lease_deposit",
      amount_native: 500,
      paid_amount_native: 0,
    }),
  ];
  const row = former(data);
  expect(row.balances).toEqual([
    {
      currency: "USD",
      category: "lease_rent",
      outstanding: 2200,
      overdue: 2200,
      nextDue: "2026-11-01",
    },
    {
      currency: "XOF",
      category: "property_fee",
      outstanding: 7500,
      overdue: 7500,
      nextDue: "2026-11-01",
    },
    {
      currency: "USD",
      category: "lease_deposit",
      outstanding: 500,
      overdue: 500,
      nextDue: "2026-11-01",
    },
  ]);
  expect(row.attention).toMatchObject({ kind: "overdue", amount: null });
  expect(row.attention?.currency).toBeUndefined();
});

it.each([
  { status: "paid" },
  { customer_id: workspaceCustomer },
  { currency: "XOF", amount_xof: 100, paid_amount_xof: 0 },
  { category: "property_fee" },
] as Partial<ReceivableRow>[])(
  "keeps positive but conflicting historic bills for review (%j)",
  (overrides) => {
    const data = input();
    data.receivables = [bill(overrides)];
    expect(former(data)).toMatchObject({
      attention: { kind: "coverage", amount: null },
      balances: [],
      reviewReasons: ["billing_data_conflict"],
    });
  },
);

it("does not end an active record merely because the registered expected end has passed", () => {
  const data = input();
  Object.assign(data.contracts[0], { expected_end_date: "2026-01-02" });
  let row = buildLeaseRecordOverview(data)[0];
  expect(row).toMatchObject({ historical: false, occupancy: "leased" });
  Object.assign(data.contracts[0], { actual_end_date: "2026-11-01" });
  row = buildLeaseRecordOverview(data)[0];
  expect(row).toMatchObject({ historical: true, contract: { status: "active" } });
  expect(row.reviewReasons).toContain("record_status_end_conflict");
});

it("restricts current upcoming amounts to 15 days while preserving all unsettled balances", () => {
  const data = input();
  data.receivables = [
    bill({
      source_id: workspaceContract,
      customer_id: workspaceCustomer,
      currency: "XOF",
      amount_xof: 100,
      paid_amount_xof: 0,
      due_date: "2026-11-08",
      status: "pending",
    }),
    bill({
      id: "66666666-6666-4666-8666-666666666666",
      source_id: workspaceContract,
      customer_id: workspaceCustomer,
      currency: "XOF",
      amount_xof: 100,
      paid_amount_xof: 0,
      due_date: "2027-01-08",
      status: "pending",
    }),
  ];
  const row = buildLeaseRecordOverview(data)[0];
  expect(row.attention).toMatchObject({ kind: "upcoming", amount: 100, currency: "XOF" });
  expect(row.balances[0].outstanding).toBe(200);
  expect(buildLeaseRoomOverview(data)[0].attention).toMatchObject({
    kind: "upcoming",
    amount: 100,
  });
});
