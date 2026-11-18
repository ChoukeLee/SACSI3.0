import { expect, it } from "vitest";
import type { LeaseContractRow, ReceivableRow } from "@/types/database";
import {
  buildLeaseRecordOverview,
  buildLeaseRoomOverview,
  resolveApartmentPaidThroughReminder,
  type LeaseRoomOverviewInput,
} from "@/features/leases/lease-room-overview-model";
import {
  workspaceBuilding,
  workspaceContract,
  workspaceCustomer,
  workspaceFixture,
  workspaceUnit,
} from "./fixtures/contract-workspace";

function input(): LeaseRoomOverviewInput {
  const value = workspaceFixture();
  Object.assign(value.units[0], {
    unit_no: "702",
    kind: "apartment",
    asset_subtype: "apartment",
    status: "leased",
  });
  Object.assign(value.contracts[0], {
    status: "active",
    commencement_state: "started",
    start_date: "2026-01-01",
    expected_end_date: "2026-09-30",
    expected_end_confirmed: false,
    paid_through_date: "2026-11-30",
    actual_end_date: null,
    monthly_rent_xof: 650000,
    rent_currency: "XOF",
    monthly_rent_amount: null,
    payment_cycle: "monthly",
    payment_day: 31,
  });
  return {
    units: value.units,
    contracts: value.contracts as LeaseContractRow[],
    customers: value.customers,
    buildings: value.buildings,
    today: "2026-11-18",
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
    amount_xof: 650000,
    paid_amount_xof: 0,
    amount_native: null,
    paid_amount_native: null,
    due_date: "2026-12-01",
    status: "pending",
    management_status: "managed",
    service_period_start: null,
    service_period_end: null,
    title: "Synthetic registered rent",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function rows(value: LeaseRoomOverviewInput) {
  return {
    room: buildLeaseRoomOverview(value)[0],
    record: buildLeaseRecordOverview(value).find((r) => r.id === workspaceContract)!,
  };
}

function expectPaidThroughReminder(value: LeaseRoomOverviewInput, days = 12) {
  const { room, record } = rows(value);
  expect(room.attention).toEqual({
    kind: "upcoming",
    basis: "paid_through",
    dueDate: "2026-11-30",
    days,
    amount: null,
    amountIsEstimated: false,
  });
  expect(record.attention).toEqual(room.attention);
  expect(record.balances).toEqual([]);
}

it("keeps a positive billing balance with an unknown due date in review", () => {
  const value = input();
  value.receivables = undefined;
  value.summaries = {
    [workspaceContract]: {
      total: 650000,
      paid: 0,
      outstanding: 650000,
      overdue: 650000,
      nextDue: null,
      count: 1,
    },
  };
  const result = rows(value);
  expect(result.room.attention?.kind).toBe("coverage");
  expect(result.record.attention?.kind).toBe("coverage");
  expect(result.room.attention?.basis).toBeUndefined();
});

it("reminds from the registered paid-through date even when no next bill exists", () => {
  const value = input();
  const before = structuredClone(value);
  expectPaidThroughReminder(value);
  expect(value).toEqual(before);
});

it("retains the reminder when every old rent bill was paid and the next bill is absent", () => {
  const value = input();
  value.receivables = [
    bill({ due_date: "2026-10-01", status: "paid", paid_amount_xof: 650000 }),
    bill({
      id: "88888888-8888-4888-8888-888888888888",
      due_date: "2026-08-01",
      amount_xof: 1300000,
      paid_amount_xof: 1300000,
      status: "paid",
    }),
  ];
  const before = structuredClone(value);
  expectPaidThroughReminder(value);
  expect(value).toEqual(before);
});

it("uses the same coverage reminder for a fully paid summary-only read", () => {
  const value = input();
  delete value.receivables;
  value.summaries = {
    [workspaceContract]: {
      total: 1950000,
      paid: 1950000,
      outstanding: 0,
      overdue: 0,
      nextDue: null,
      count: 2,
      dueOutstanding: 0,
    },
  };
  expectPaidThroughReminder(value);
});

it.each([
  ["2026-11-15", 15],
  ["2026-11-18", 12],
  ["2026-11-30", 0],
] as const)("includes the coverage reminder window on %s", (today, days) => {
  const value = input();
  value.today = today;
  expectPaidThroughReminder(value, days);
});

it.each(["2026-11-14", "2026-12-01"])(
  "does not label coverage outside the 0–15-day window as an upcoming reminder on %s",
  (today) => {
    const value = input();
    value.today = today;
    expect(
      resolveApartmentPaidThroughReminder(value.contracts[0], value.units[0], today),
    ).toBeNull();
    const { room, record } = rows(value);
    expect(room.attention?.basis).not.toBe("paid_through");
    expect(record.attention?.basis).not.toBe("paid_through");
  },
);

it("still reminds for a sold apartment with an active rental, retaining its ownership status", () => {
  const value = input();
  value.units[0].status = "sold";
  expectPaidThroughReminder(value);
  expect(value.units[0].status).toBe("sold");
});

it("keeps an active apartment's coverage reminder when its recorded expected end needs review", () => {
  const value = input();
  Object.assign(value.contracts[0], {
    expected_end_date: "2026-09-30",
    expected_end_confirmed: true,
    actual_end_date: null,
  });
  expectPaidThroughReminder(value);
  const { room, record } = rows(value);
  expect(room.reviewReasons).toContain("registered_period_needs_review");
  expect(record.reviewReasons).toContain("registered_period_needs_review");
  expect(value.contracts[0].actual_end_date).toBeNull();
});

it.each(["SACSI3", "SACSI5", "SACSI6", "SACSI7", "SACSI11"])(
  "applies to active apartment rentals in %s without a building-specific exception",
  (code) => {
    const value = input();
    value.buildings[0].code = code;
    value.units[0].unit_no = "1802";
    expectPaidThroughReminder(value);
  },
);

it("keeps the actual next bill's due date and amount ahead of the coverage reminder", () => {
  const value = input();
  value.receivables = [bill()];
  const { room, record } = rows(value);
  expect(room.attention).toMatchObject({
    kind: "upcoming",
    dueDate: "2026-12-01",
    days: 13,
    amount: 650000,
    currency: "XOF",
    amountIsEstimated: false,
  });
  expect(room.attention?.basis).not.toBe("paid_through");
  expect(record.attention).toEqual(room.attention);
  expect(record.balances).toMatchObject([{ outstanding: 650000 }]);
});

it("does not hide an actual overdue bill behind an upcoming coverage date", () => {
  const value = input();
  value.receivables = [bill({ due_date: "2026-11-17", status: "overdue" })];
  const { room, record } = rows(value);
  expect(room.attention).toMatchObject({
    kind: "overdue",
    dueDate: "2026-11-17",
    days: -1,
    amount: 650000,
  });
  expect(room.attention?.basis).not.toBe("paid_through");
  expect(record.attention).toEqual(room.attention);
});

it.each(["USD", "CNY"] as const)(
  "reminds for %s rent without inventing a balance or converting its currency",
  (currency) => {
    const value = input();
    Object.assign(value.contracts[0], {
      rent_currency: currency,
      monthly_rent_amount: 3200,
      monthly_rent_xof: 1987654,
    });
    value.receivables = [
      bill({
        currency,
        amount_native: 6400,
        paid_amount_native: 6400,
        amount_xof: 3975308,
        paid_amount_xof: 3975308,
        status: "paid",
        due_date: "2026-10-01",
      }),
    ];
    const before = structuredClone(value);
    expectPaidThroughReminder(value);
    expect(value).toEqual(before);
  },
);

it.each(["terminated", "expired", "draft"] as const)(
  "does not turn a %s record's paid-through date into a new coverage reminder",
  (status) => {
    const value = input();
    value.contracts[0].status = status;
    const { room, record } = rows(value);
    expect(room.attention?.basis).not.toBe("paid_through");
    expect(record.attention?.basis).not.toBe("paid_through");
  },
);

it.each(["not_started", "pending_project_opening"])(
  "does not give a current-rent coverage reminder to a %s rental",
  (commencement_state) => {
    const value = input();
    Object.assign(value.contracts[0], { commencement_state });
    const { room, record } = rows(value);
    expect(room.attention?.basis).not.toBe("paid_through");
    expect(record.attention?.basis).not.toBe("paid_through");
  },
);

it.each([
  { start_date: "2026-11-20" },
  { start_date: null },
  { actual_end_date: "2026-11-17" },
  { paid_through_date: null },
  { paid_through_date: "2026-02-30" },
])("does not create a coverage reminder with invalid or ineligible dates %j", (patch) => {
  const value = input();
  Object.assign(value.contracts[0], patch);
  const { room, record } = rows(value);
  expect(room.attention?.basis).not.toBe("paid_through");
  expect(record.attention?.basis).not.toBe("paid_through");
});

it("keeps a multiple-active-record conflict for review instead of choosing a coverage date", () => {
  const value = input();
  value.contracts = [
    value.contracts[0],
    { ...value.contracts[0], id: "99999999-9999-4999-8999-999999999999" },
  ];
  const { room, record } = rows(value);
  expect(room.conflict).toBe(true);
  expect(record.conflict).toBe(true);
  expect(room.attention?.basis).not.toBe("paid_through");
  expect(record.attention?.basis).not.toBe("paid_through");
});

it("does not hide inconsistent bill ownership under a date-only reminder", () => {
  const value = input();
  value.receivables = [bill({ customer_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })];
  const { room, record } = rows(value);
  expect(room.reviewReasons).toContain("billing_data_conflict");
  expect(record.reviewReasons).toContain("billing_data_conflict");
  expect(room.attention?.kind).toBe("coverage");
  expect(record.attention?.kind).toBe("coverage");
  expect(room.attention?.basis).not.toBe("paid_through");
  expect(record.attention?.basis).not.toBe("paid_through");
});

it("does not add this apartment reminder to a commercial shop", () => {
  const value = input();
  Object.assign(value.units[0], { kind: "storefront", asset_subtype: "commercial_shop" });
  const { room, record } = rows(value);
  expect(room.attention?.basis).not.toBe("paid_through");
  expect(record.attention?.basis).not.toBe("paid_through");
});
