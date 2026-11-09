import { expect, it } from "vitest";
import {
  buildLeaseRoomOverview,
  decodeLeaseRoomReceivables,
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
