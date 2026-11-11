import { expect, it } from "vitest";
import {
  buildLeaseRecordOverview,
  buildLeaseRoomOverview,
  decodeLeaseRoomReceivables,
  leaseRoomMatchesSearch,
  type LeaseRoomOverviewInput,
} from "./lease-room-overview-model";
import {
  workspaceFixture,
  workspaceContract,
  workspaceCustomer,
  workspaceUnit,
  workspaceBuilding,
} from "../../../tests/fixtures/contract-workspace";
import type { LeaseContractRow, ReceivableRow } from "@/types/database";

function input(): LeaseRoomOverviewInput {
  const data = workspaceFixture();
  return {
    units: data.units,
    contracts: data.contracts as LeaseContractRow[],
    customers: data.customers,
    buildings: data.buildings,
    today: "2026-11-07",
    receivables: [],
  };
}
function bill(overrides: Partial<ReceivableRow> = {}): ReceivableRow {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    source_type: "lease_contract",
    source_id: workspaceContract,
    unit_id: workspaceUnit,
    building_id: workspaceBuilding,
    customer_id: workspaceCustomer,
    category: "lease_rent",
    currency: "XOF",
    amount_xof: 100,
    paid_amount_xof: 0,
    amount_native: null,
    paid_amount_native: null,
    due_date: "2026-11-22",
    status: "pending",
    management_status: "managed",
    title: "Registered rent",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

it("keeps paperless registered tenants, rent and coverage visible without inventing debt", () => {
  const data = input();
  Object.assign(data.contracts[0], {
    attachment_url: null,
    contract_no: "",
    paid_through_date: "2026-12-31",
    deposit_amount_xof: 0,
  });
  const row = buildLeaseRoomOverview(data)[0];
  expect(row.customer?.id).toBe(workspaceCustomer);
  expect(row.contract?.monthly_rent_xof).toBe(100);
  expect(row.paidThrough).toBe("2026-12-31");
  expect(row.occupancy).toBe("leased");
  expect(row.attention).toBeNull();
});

it("suppresses an unconfirmed past end date and keeps a confirmed one visible", () => {
  const data = input();
  const contract = data.contracts[0];
  Object.assign(contract, {
    expected_end_date: "2026-10-09",
    expected_end_confirmed: false,
    paid_through_date: "2027-01-09",
  });
  data.receivables = [bill({ due_date: "2027-01-10" })];

  const [row] = buildLeaseRoomOverview(data);
  expect(row.paidThrough).toBe("2027-01-09");
  expect(row.reviewReasons).not.toContain("registered_period_needs_review");
  expect(row.attention).toBeNull();

  contract.expected_end_confirmed = true;
  expect(buildLeaseRoomOverview(data)[0].reviewReasons).toContain("registered_period_needs_review");

  contract.expected_end_confirmed = false;
  contract.paid_through_date = "2026-11-06";
  expect(buildLeaseRoomOverview(data)[0].reviewReasons).not.toContain(
    "registered_period_needs_review",
  );

  contract.paid_through_date = data.today;
  data.receivables = [bill({ due_date: "2026-11-06" })];
  const [withArrears] = buildLeaseRoomOverview(data);
  expect(withArrears.reviewReasons).not.toContain("registered_period_needs_review");
  expect(withArrears.attention).toMatchObject({ kind: "overdue", dueDate: "2026-11-06" });
});

it.each([
  ["2026-10-01", "upcoming", 0, 60, false],
  ["2026-10-02", "overdue", -1, 60, false],
  ["2026-11-01", "overdue", -31, 60, false],
  ["2026-11-10", "overdue", -40, 160, true],
] as const)(
  "projects overdue months after their due date on %s",
  (today, kind, days, amount, estimated) => {
    const data = input();
    data.today = today;
    data.contracts[0].paid_through_date = "2026-09-30";
    data.receivables = [
      bill({
        due_date: "2026-10-01",
        service_period_start: "2026-10-01",
        service_period_end: "2026-10-31",
        status: "partial",
        paid_amount_xof: 40,
      }),
    ];

    const [room] = buildLeaseRoomOverview(data);
    const [record] = buildLeaseRecordOverview(data);
    expect(room.attention).toMatchObject({ kind, days, amount, amountIsEstimated: estimated });
    expect(record.attention).toEqual(room.attention);
    expect(record.balances).toMatchObject([{ outstanding: 60 }]);
  },
);

it("retains real fees and later rent balances without projecting rent for the same period", () => {
  const data = input();
  data.today = "2026-11-10";
  data.contracts[0].paid_through_date = "2026-09-30";
  data.receivables = [
    bill({ due_date: "2026-10-01" }),
    bill({
      id: "next-rent",
      due_date: "2026-11-07",
      service_period_start: "2026-11-01",
      service_period_end: "2026-11-30",
      status: "partial",
      paid_amount_xof: 30,
    }),
    bill({ id: "fee", due_date: "2026-10-01", category: "property_fee", amount_xof: 20 }),
  ];
  const [room] = buildLeaseRoomOverview(data);
  expect(room.attention).toMatchObject({ kind: "overdue", amount: 190, amountIsEstimated: false });
  expect(buildLeaseRecordOverview(data)[0].attention).toEqual(room.attention);
});

it.each([
  ["cancelled", "excluded", 200, true],
  ["cancelled", "managed", 100, false],
  ["pending", "excluded", 100, false],
] as const)(
  "handles a later %s/%s rent bill when projecting monthly arrears",
  (status, management_status, amount, amountIsEstimated) => {
    const data = input();
    data.today = "2026-11-10";
    data.contracts[0].paid_through_date = "2026-09-30";
    data.receivables = [
      bill({ due_date: "2026-10-01" }),
      bill({ id: "previous-plan", due_date: "2026-11-01", status, management_status }),
    ];
    const [room] = buildLeaseRoomOverview(data);
    const [record] = buildLeaseRecordOverview(data);
    expect(room.attention).toMatchObject({ kind: "overdue", amount, amountIsEstimated });
    expect(record.attention).toEqual(room.attention);
    expect(record.balances).toMatchObject([{ outstanding: 100 }]);
  },
);

it("waits for a managed first-uncovered bill with a later due date and keeps ambiguous bills actual", () => {
  const data = input();
  data.today = "2026-11-24";
  Object.assign(data.contracts[0], {
    paid_through_date: "2026-11-23",
    expected_end_date: "2026-09-30",
    expected_end_confirmed: false,
  });
  const first = bill({
    due_date: "2026-12-12",
    service_period_start: "2026-11-24",
    service_period_end: "2026-12-23",
  });
  data.receivables = [first];
  expect(buildLeaseRoomOverview(data)[0].attention).toBeNull();
  expect(buildLeaseRecordOverview(data)[0].attention).toBeNull();

  data.today = "2027-01-13";
  expect(buildLeaseRoomOverview(data)[0].attention).toMatchObject({
    amount: 200,
    amountIsEstimated: true,
  });
  data.receivables = [first, bill({ id: "unknown-period", due_date: "2027-01-16" })];
  expect(buildLeaseRoomOverview(data)[0].attention).toMatchObject({
    amount: 100,
    amountIsEstimated: false,
  });
});

it("uses the agreed payment day after a first due date shortened by February", () => {
  const data = input();
  Object.assign(data.contracts[0], {
    payment_day: 31,
    paid_through_date: "2026-02-27",
  });
  data.receivables = [bill({ due_date: "2026-02-28" })];
  data.today = "2026-03-31";
  expect(buildLeaseRoomOverview(data)[0].attention).toMatchObject({
    amount: 100,
    amountIsEstimated: false,
  });
  data.today = "2026-04-01";
  expect(buildLeaseRoomOverview(data)[0].attention).toMatchObject({
    amount: 200,
    amountIsEstimated: true,
  });
});

it("finds apartment rooms by building, room, tenant or lease reference", () => {
  const [row] = buildLeaseRoomOverview(input());
  expect(leaseRoomMatchesSearch(row, "sacsi11 101")).toBe(true);
  expect(leaseRoomMatchesSearch(row, " Synthetic guest ")).toBe(true);
  expect(leaseRoomMatchesSearch(row, "synthetic-0")).toBe(true);
  expect(leaseRoomMatchesSearch(row, "sacsi11 102")).toBe(false);
});

it.each([undefined, []] as const)(
  "uses registered coverage only as a follow-up horizon when bills are unavailable (%s)",
  (receivables) => {
    const data = input();
    data.receivables = receivables;
    for (const rentCurrency of ["XOF", "USD", "CNY"] as const) {
      Object.assign(data.contracts[0], {
        rent_currency: rentCurrency,
        monthly_rent_amount: 2500,
        paid_through_date: "2026-11-23",
        attachment_url: null,
        contract_no: "",
      });
      expect(buildLeaseRoomOverview(data)[0].attention).toBeNull();
      for (const through of ["2026-11-22", "2026-11-06", null]) {
        Object.assign(data.contracts[0], { paid_through_date: through });
        expect(buildLeaseRoomOverview(data)[0].attention).toMatchObject({
          kind: "coverage",
          amount: null,
          days: null,
        });
      }
    }
  },
);

it("keeps explicit arrears and bill conflicts visible despite distant registered coverage", () => {
  const data = input();
  Object.assign(data.contracts[0], { paid_through_date: "2027-12-31" });
  data.receivables = [bill({ due_date: "2026-11-01" })];
  expect(buildLeaseRoomOverview(data)[0].attention?.kind).toBe("overdue");
  data.receivables = [bill({ due_date: "2026-11-01", status: "paid" })];
  expect(buildLeaseRoomOverview(data)[0].attention?.kind).toBe("coverage");
  data.receivables = undefined;
  data.summaries = {
    [workspaceContract]: {
      total: 100,
      paid: 0,
      outstanding: 100,
      overdue: 100,
      nextDue: "2026-11-01",
      count: 1,
    },
  };
  expect(buildLeaseRoomOverview(data)[0].attention?.kind).toBe("overdue");
  Object.assign(data.contracts[0], { rent_currency: "USD", monthly_rent_amount: 3200 });
  expect(buildLeaseRoomOverview(data)[0].attention).toMatchObject({
    kind: "overdue",
    currency: "XOF",
    amount: 100,
  });
  data.receivables = [];
  expect(buildLeaseRoomOverview(data)[0].attention?.kind).toBe("coverage");
  expect(buildLeaseRoomOverview(data)[0].reviewReasons).toContain("billing_data_conflict");
});

it.each([
  ["2026-11-22", "upcoming", 15],
  ["2026-11-07", "upcoming", 0],
  ["2026-11-06", "overdue", -1],
] as const)(
  "uses the actual bill due date %s instead of coverage end or contract day",
  (dueDate, kind, days) => {
    const data = input();
    Object.assign(data.contracts[0], { payment_day: 1, paid_through_date: "2026-12-31" });
    data.receivables = [bill({ due_date: dueDate })];
    expect(buildLeaseRoomOverview(data)[0].attention).toMatchObject({
      kind,
      dueDate,
      days,
      amount: 100,
      currency: "XOF",
    });
  },
);

it("keeps native rent independent and only includes imminent bills in reminder amounts", () => {
  const data = input();
  Object.assign(data.contracts[0], {
    rent_currency: "USD",
    monthly_rent_amount: 3200,
    monthly_rent_xof: 0,
    paid_through_date: "2026-12-31",
  });
  data.receivables = [
    bill({ currency: "USD", amount_xof: 0, amount_native: 3200, paid_amount_native: 200 }),
    bill({
      id: "88888888-8888-4888-8888-888888888888",
      currency: "USD",
      amount_xof: 0,
      amount_native: 9600,
      paid_amount_native: 0,
      due_date: "2027-01-01",
    }),
  ];
  expect(buildLeaseRoomOverview(data)[0].attention).toMatchObject({
    kind: "upcoming",
    amount: 3000,
    currency: "USD",
    days: 15,
  });
});

it("does not mix overdue XOF fees and USD rent into one currency amount", () => {
  const data = input();
  Object.assign(data.contracts[0], {
    rent_currency: "USD",
    monthly_rent_amount: 3200,
    monthly_rent_xof: 0,
  });
  data.receivables = [
    bill({
      currency: "USD",
      amount_xof: 0,
      amount_native: 3200,
      paid_amount_native: 0,
      due_date: "2026-11-01",
    }),
    bill({
      id: "88888888-8888-4888-8888-888888888888",
      category: "property_fee",
      due_date: "2026-11-01",
    }),
  ];
  expect(buildLeaseRoomOverview(data)[0].attention).toMatchObject({
    kind: "overdue",
    amount: null,
  });
  expect(buildLeaseRoomOverview(data)[0].attention?.currency).toBeUndefined();
});

it("keeps historical-pending balances out of reminders and does not treat missing native values as zero", () => {
  const data = input();
  data.receivables = [bill({ management_status: "historical_pending", due_date: "2020-01-01" })];
  expect(buildLeaseRoomOverview(data)[0].attention?.kind).toBe("coverage");
  Object.assign(data.contracts[0], {
    rent_currency: "CNY",
    monthly_rent_amount: 2500,
    monthly_rent_xof: 0,
  });
  data.receivables = [
    bill({ currency: "CNY", amount_xof: 0, amount_native: null, paid_amount_native: null }),
  ];
  const row = buildLeaseRoomOverview(data)[0];
  expect(row.attention?.kind).toBe("coverage");
  expect(row.reviewReasons).toContain("billing_data_conflict");
});

it("preserves complete inventory and refuses foreign or duplicate bill identities", () => {
  const data = input();
  data.units = Array.from({ length: 1005 }, (_, index) => ({
    ...data.units[0],
    id: index === 0 ? workspaceUnit : `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`,
    unit_no: String(index + 1),
  }));
  expect(buildLeaseRoomOverview(data)).toHaveLength(1005);
  expect(() =>
    decodeLeaseRoomReceivables([bill({ source_id: "other" })], data.contracts, data.units),
  ).toThrow();
  expect(() => decodeLeaseRoomReceivables([bill(), bill()], data.contracts, data.units)).toThrow();
  expect(() =>
    decodeLeaseRoomReceivables([bill({ unit_id: "other" })], data.contracts, data.units),
  ).toThrow();
});
