import { expect, it } from "vitest";
import type { LeaseContractRow, ReceivableRow } from "@/types/database";
import { apartmentRentReminderLabel } from "@/features/leases/lease-display-model";
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
  expect(result.room.attention?.rentReminder).toBeUndefined();
  expect(result.record.attention?.rentReminder).toBeUndefined();
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

it("uses the apartment coverage countdown while preserving the real next bill's due date and amount", () => {
  const value = input();
  value.receivables = [bill()];
  const before = structuredClone(value);
  const { room, record } = rows(value);
  expect(room.attention).toMatchObject({
    kind: "upcoming",
    dueDate: "2026-12-01",
    days: 13,
    amount: 650000,
    currency: "XOF",
    amountIsEstimated: false,
    rentReminder: { paidThrough: "2026-11-30", days: 12 },
  });
  expect(room.attention?.basis).not.toBe("paid_through");
  expect(apartmentRentReminderLabel(room.attention!, true)).toBe("12天后缴租到期");
  const noBill = rows(input());
  expect(apartmentRentReminderLabel(noBill.room.attention!, true)).toBe(
    apartmentRentReminderLabel(room.attention!, true),
  );
  expect(record.attention).toEqual(room.attention);
  expect(record.balances).toMatchObject([{ outstanding: 650000 }]);
  expect(value).toEqual(before);
});

it("starts the apartment reminder 15 days before coverage ends even when the real bill is due in 16 days", () => {
  const value = input();
  value.today = "2026-11-15";
  value.receivables = [bill()];
  const { room, record } = rows(value);
  expect(room.attention).toMatchObject({
    kind: "upcoming",
    dueDate: "2026-12-01",
    days: 16,
    amount: 650000,
    currency: "XOF",
    amountIsEstimated: false,
    rentReminder: { paidThrough: "2026-11-30", days: 15 },
  });
  expect(room.attention?.basis).toBeUndefined();
  expect(apartmentRentReminderLabel(room.attention!, true)).toBe("15天后缴租到期");
  expect(record.attention).toEqual(room.attention);
  expect(record.balances).toMatchObject([{ outstanding: 650000 }]);
});

it("does not start the real bill reminder when apartment coverage is still 16 days away", () => {
  const value = input();
  value.today = "2026-11-14";
  value.receivables = [bill()];
  const { room, record } = rows(value);
  expect(room.attention).toBeNull();
  expect(record.attention).toBeNull();
});

it.each(["detailed", "summary"] as const)(
  "does not count a distant January bill as an imminent apartment amount in a %s read",
  (mode) => {
    const value = input();
    if (mode === "detailed") value.receivables = [bill({ due_date: "2027-01-01" })];
    else {
      delete value.receivables;
      value.summaries = {
        [workspaceContract]: {
          total: 650000,
          paid: 0,
          outstanding: 650000,
          overdue: 0,
          nextDue: "2027-01-01",
          count: 1,
          dueOutstanding: 0,
        },
      };
    }
    const before = structuredClone(value);
    const { room, record } = rows(value);
    expect(room.attention).toEqual({
      kind: "upcoming",
      basis: "paid_through",
      dueDate: "2026-11-30",
      days: 12,
      amount: null,
      amountIsEstimated: false,
    });
    expect(record.attention).toEqual(room.attention);
    expect(apartmentRentReminderLabel(room.attention!, true)).toBe("12天后缴租到期");
    if (mode === "detailed")
      expect(record.balances).toMatchObject([
        { outstanding: 650000, nextDue: "2027-01-01", currency: "XOF" },
      ]);
    expect(value).toEqual(before);
  },
);

it.each([
  ["2026-11-15", 16, 15],
  ["2026-11-18", 13, 12],
] as const)(
  "keeps real summary-only bill facts and adds the coverage countdown on %s",
  (today, billDays, reminderDays) => {
    const value = input();
    value.today = today;
    delete value.receivables;
    value.summaries = {
      [workspaceContract]: {
        total: 650000,
        paid: 0,
        outstanding: 650000,
        overdue: 0,
        nextDue: "2026-12-01",
        count: 1,
        dueOutstanding: 0,
      },
    };
    const { room, record } = rows(value);
    expect(room.attention).toMatchObject({
      kind: "upcoming",
      dueDate: "2026-12-01",
      days: billDays,
      amount: 650000,
      currency: "XOF",
      rentReminder: { paidThrough: "2026-11-30", days: reminderDays },
    });
    expect(record.attention).toEqual(room.attention);
  },
);

it("labels the last covered day as today while preserving tomorrow's actual bill deadline", () => {
  const value = input();
  value.today = "2026-11-30";
  value.receivables = [bill()];
  const { room, record } = rows(value);
  expect(room.attention).toMatchObject({
    dueDate: "2026-12-01",
    days: 1,
    amount: 650000,
    rentReminder: { paidThrough: "2026-11-30", days: 0 },
  });
  expect(apartmentRentReminderLabel(room.attention!, true)).toBe("今日缴租到期");
  expect(record.attention).toEqual(room.attention);
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
  expect(room.attention?.rentReminder).toBeUndefined();
  expect(record.attention).toEqual(room.attention);
});

it.each(["USD", "CNY"] as const)(
  "preserves the %s amount of a real bill while attaching the same apartment coverage countdown",
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
        amount_native: 3200,
        paid_amount_native: 0,
        amount_xof: 1987654,
        paid_amount_xof: 0,
      }),
    ];
    const before = structuredClone(value);
    const { room, record } = rows(value);
    expect(room.attention).toMatchObject({
      kind: "upcoming",
      dueDate: "2026-12-01",
      days: 13,
      amount: 3200,
      currency,
      rentReminder: { paidThrough: "2026-11-30", days: 12 },
    });
    expect(apartmentRentReminderLabel(room.attention!, true)).toBe("12天后缴租到期");
    expect(record.attention).toEqual(room.attention);
    expect(record.balances).toMatchObject([{ outstanding: 3200, currency }]);
    expect(value).toEqual(before);
  },
);

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
  expect(room.attention?.rentReminder).toBeUndefined();
  expect(record.attention?.rentReminder).toBeUndefined();
});

it("does not add a coverage countdown to real bill attention during an active-rental conflict", () => {
  const value = input();
  value.receivables = [bill()];
  value.contracts = [
    value.contracts[0],
    { ...value.contracts[0], id: "99999999-9999-4999-8999-999999999999" },
  ];
  const { room, record } = rows(value);
  expect(room.conflict).toBe(true);
  expect(record.conflict).toBe(true);
  expect(room.attention?.rentReminder).toBeUndefined();
  expect(record.attention?.rentReminder).toBeUndefined();
});

it("does not use coverage to bring a 16-day bill into the reminder window during an active-rental conflict", () => {
  const value = input();
  value.today = "2026-11-15";
  value.receivables = [bill()];
  value.contracts = [
    value.contracts[0],
    { ...value.contracts[0], id: "99999999-9999-4999-8999-999999999999" },
  ];
  const { room, record } = rows(value);
  expect(room.conflict).toBe(true);
  expect(record.conflict).toBe(true);
  expect(room.attention?.kind).not.toBe("upcoming");
  expect(record.attention?.kind).not.toBe("upcoming");
  expect(room.attention?.rentReminder).toBeUndefined();
  expect(record.attention?.rentReminder).toBeUndefined();
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
