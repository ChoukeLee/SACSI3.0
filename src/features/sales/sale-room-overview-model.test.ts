import { expect, it } from "vitest";
import type {
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  SalePaymentScheduleRow,
} from "@/types/database";
import {
  buildSaleRecordOverview,
  buildSaleRoomOverview,
  buildSalePurchaseReceiptSummary,
  decodeSaleRoomFinance,
  type SaleRoomOverviewInput,
} from "./sale-room-overview-model";
import { saleFixture } from "../../../tests/fixtures/sale-workbench";
import {
  workspaceBuilding,
  workspaceContract,
  workspaceCustomer,
  workspaceUnit,
} from "../../../tests/fixtures/contract-workspace";
import { decodeWorkspace, parseWorkspaceQuery } from "@/features/contracts/workspace-model";

const oldId = "99999999-9999-4999-8999-999999999999",
  oldCustomer = "88888888-8888-4888-8888-888888888888";
function input(): SaleRoomOverviewInput {
  const d = saleFixture(undefined, "context", 1);
  return {
    units: d.units,
    contracts: d.contracts as SaleContractRow[],
    customers: d.customers,
    buildings: d.buildings,
    today: "2026-11-07",
    payments: [],
    receivables: [],
    schedules: [],
  };
}
function bill(overrides: Partial<ReceivableRow> = {}): ReceivableRow {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    source_type: "sale_contract",
    source_id: workspaceContract,
    unit_id: workspaceUnit,
    building_id: workspaceBuilding,
    customer_id: workspaceCustomer,
    category: "sale_installment",
    currency: "XOF",
    amount_xof: 1000,
    paid_amount_xof: 200,
    amount_native: null,
    paid_amount_native: null,
    due_date: "2026-11-01",
    status: "partial",
    management_status: "managed",
    title: "Synthetic installment",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
function payment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    source_type: "sale_contract",
    source_id: workspaceContract,
    unit_id: workspaceUnit,
    customer_id: workspaceCustomer,
    payment_date: "2026-11-01",
    amount: 100,
    currency: "CNY",
    exchange_rate_to_xof: 80,
    native_settlement: false,
    payment_method: "bank_transfer",
    receipt_no: null,
    notes: null,
    request_kind: null,
    reversal_of_payment_id: null,
    created_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}
function schedule(overrides: Partial<SalePaymentScheduleRow> = {}): SalePaymentScheduleRow {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    sale_contract_id: workspaceContract,
    installment_no: 1,
    due_date: "2026-11-01",
    amount_xof: 1000,
    status: "pending",
    receivable_id: bill().id,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

it("keeps registered price, actual original-currency cash and receivable allocations independent", () => {
  const d = input();
  d.payments = [payment()];
  d.receivables = [bill()];
  d.schedules = [schedule()];
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({
    priceXof: 1000000,
    receivedNative: [{ currency: "CNY", amount: 100 }],
    outstandingNative: [{ currency: "XOF", amount: 800 }],
    attention: { kind: "overdue", amounts: [{ currency: "XOF", amount: 800 }] },
  });
});
it("keeps former buyers and their unsettled bills separate from a replacement record", () => {
  const d = input();
  d.contracts = [
    ...d.contracts,
    { ...d.contracts[0], id: oldId, customer_id: oldCustomer, status: "terminated" },
  ];
  d.customers = [...d.customers, { ...d.customers[0], id: oldCustomer, name: "Former buyer" }];
  d.receivables = [bill({ source_id: oldId, customer_id: oldCustomer })];
  const records = buildSaleRecordOverview(d),
    room = buildSaleRoomOverview(d)[0];
  expect(records.find((row) => row.id === oldId)).toMatchObject({
    historical: true,
    customer: { id: oldCustomer },
    attention: { kind: "overdue" },
  });
  expect(room.record).toMatchObject({ id: workspaceContract, attention: null });
  expect(room.records).toHaveLength(2);
});
it.each([
  ["2026-11-06", "overdue"],
  ["2026-11-07", "upcoming"],
  ["2026-11-22", "upcoming"],
  ["2026-11-23", null],
] as const)("uses explicit due %s with the inclusive 15-day boundary", (dueDate, kind) => {
  const d = input();
  d.receivables = [bill({ due_date: dueDate })];
  expect(buildSaleRecordOverview(d)[0].attention?.kind ?? null).toBe(kind);
});
it("keeps distant future balances out of imminent amounts but preserves their full balance", () => {
  const d = input();
  d.receivables = [
    bill({ amount_xof: 100, paid_amount_xof: 0, due_date: "2026-11-08" }),
    bill({ id: oldId, amount_xof: 200, paid_amount_xof: 0, due_date: "2027-01-01" }),
  ];
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({
    outstandingNative: [{ currency: "XOF", amount: 300 }],
    attention: { kind: "upcoming", amounts: [{ currency: "XOF", amount: 100 }] },
  });
  Object.assign(d.contracts[0], { status: "terminated" });
  expect(buildSaleRecordOverview(d)[0].attention).toMatchObject({
    kind: "unsettled",
    amounts: [{ currency: "XOF", amount: 300 }],
  });
});
it("never manufactures a debt from total price, missing evidence or paid historical plans", () => {
  const d = input();
  Object.assign(d.contracts[0], { status: "expired" });
  expect(buildSaleRecordOverview(d)[0].attention).toBeNull();
  expect(buildSaleRecordOverview(d)[0].outstandingNative).toBeNull();
  d.schedules = [schedule({ status: "paid", receivable_id: null })];
  expect(buildSaleRecordOverview(d)[0].attention).toBeNull();
  expect(buildSaleRecordOverview(d)[0].outstandingNative).toBeNull();
  d.receivables = [bill({ status: "paid", paid_amount_xof: 1000 })];
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({ attention: null, outstandingNative: [] });
});
it("keeps existing plans without verified balances and historical-pending balances as review", () => {
  const d = input();
  d.schedules = [schedule({ receivable_id: null })];
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({
    attention: { kind: "review", amounts: [] },
    outstandingNative: null,
  });
  d.schedules = [];
  d.receivables = [bill({ management_status: "historical_pending" })];
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({
    attention: { kind: "review" },
    outstandingNative: null,
  });
});
it("ignores cancelled/excluded obligations and never counts the schedule a second time", () => {
  const d = input();
  d.receivables = [
    bill(),
    bill({ id: oldId, status: "cancelled" }),
    bill({ id: oldCustomer, management_status: "excluded" }),
  ];
  d.schedules = [schedule()];
  expect(buildSaleRecordOverview(d)[0].outstandingNative).toEqual([
    { currency: "XOF", amount: 800 },
  ]);
});
it("keeps original currency buckets and refuses to value an unknown native balance using its XOF shadow", () => {
  const d = input();
  d.receivables = [
    bill({ currency: "USD", amount_native: 3200, paid_amount_native: 1000, amount_xof: 9999999 }),
    bill({ id: oldId, amount_xof: 10, paid_amount_xof: 0 }),
  ];
  expect(buildSaleRecordOverview(d)[0].outstandingNative).toEqual([
    { currency: "USD", amount: 2200 },
    { currency: "XOF", amount: 10 },
  ]);
  d.receivables = [
    bill({ currency: "CNY", amount_native: null, paid_amount_native: null, status: "pending" }),
  ];
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({
    outstandingNative: null,
    attention: { kind: "review", amounts: [] },
  });
});
it("counts gross sale cash only, without adding refunds, fees, offsets, reversals or invalid amounts", () => {
  const d = input();
  d.payments = [
    payment({ amount: 0.1 }),
    payment({ id: oldId, amount: 0.2 }),
    ...(
      [
        { source_type: "sale_refund" },
        { source_type: "sale_agency_income" },
        { source_type: "parking_fee" },
        { payment_method: "offset" },
        { reversal_of_payment_id: oldId },
        { request_kind: "sale_reversal" },
        { amount: NaN },
        { amount: -1 },
        { amount: 10.001 },
        { source_id: oldId },
      ] as Partial<PaymentRow>[]
    ).map((patch, i) =>
      payment({
        id: `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`,
        amount: 500,
        ...patch,
      }),
    ),
  ];
  expect(buildSaleRecordOverview(d)[0].receivedNative).toEqual([{ currency: "CNY", amount: 0.3 }]);
});
it("keeps all assets and records, with current-record conflicts explicit", () => {
  const d = input();
  d.units = Array.from({ length: 1001 }, (_, i) => ({
    ...d.units[0],
    id: i === 0 ? workspaceUnit : `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`,
  }));
  d.contracts = [...d.contracts, { ...d.contracts[0], id: oldId, status: "draft" }];
  const rooms = buildSaleRoomOverview(d);
  expect(rooms).toHaveLength(1001);
  expect(rooms[0]).toMatchObject({ record: null, conflict: true });
  expect(rooms[0].records).toHaveLength(2);
});
it("does not silently call unqueried detailed financial evidence complete", () => {
  const d = input();
  d.receivables = undefined;
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({ outstandingNative: null, attention: null });
});
it("includes real historical receipts with an unrecorded method, without treating them as offsets", () => {
  const d = input();
  d.payments = [
    payment({ payment_method: null }),
    payment({ id: oldId, payment_method: "offset" }),
  ];
  expect(buildSaleRecordOverview(d)[0].receivedNative).toEqual([{ currency: "CNY", amount: 100 }]);
  expect(buildSalePurchaseReceiptSummary(d.contracts[0], d.payments).amounts).toEqual([
    { currency: "CNY", amount: 100 },
  ]);
});
it("keeps native source registration price and gross cash in CNY without guessing XOF or a signature date", () => {
  const d = input();
  Object.assign(d.contracts[0], {
    signed_date: null,
    registration_basis: "source_record",
    source_reference: "synthetic workbook row65",
    sale_currency: "CNY",
    total_amount_native: 720000,
    total_amount_xof: 0,
  });
  d.payments = [
    payment({
      amount: 700000,
      native_settlement: true,
      exchange_rate_to_xof: null,
      payment_method: null,
    }),
    payment({
      id: oldId,
      amount: 20000,
      native_settlement: true,
      exchange_rate_to_xof: null,
      payment_method: null,
    }),
  ];
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({
    priceXof: null,
    priceNative: { currency: "CNY", amount: 720000 },
    receivedNative: [{ currency: "CNY", amount: 720000 }],
    attention: null,
    outstandingNative: null,
  });
  expect(buildSaleRecordOverview(d)[0].reviewReasons).not.toContain("future_registered_record");
});
it("rejects invalid native currency/source/FX combinations and invalid historical FX from purchase cash", () => {
  const d = input();
  Object.assign(d.contracts[0], {
    sale_currency: "USD",
    total_amount_xof: 0,
    total_amount_native: 300,
  });
  const good = payment({
    currency: "USD",
    amount: 100,
    native_settlement: true,
    exchange_rate_to_xof: null,
    payment_method: null,
  });
  const bad: Partial<PaymentRow>[] = [
    { source_type: "sale" },
    { unit_id: null },
    { customer_id: null },
    { currency: "CNY" },
    { exchange_rate_to_xof: 580 },
    { native_settlement: false, exchange_rate_to_xof: null },
    { native_settlement: false, exchange_rate_to_xof: 0 },
    { native_settlement: false, currency: "XOF", exchange_rate_to_xof: 2 },
  ];
  d.payments = [
    good,
    ...bad.map((patch, i) => ({
      ...good,
      id: `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`,
      ...patch,
    })),
  ];
  expect(buildSalePurchaseReceiptSummary(d.contracts[0], d.payments).amounts).toEqual([
    { currency: "USD", amount: 100 },
  ]);
});
it("preserves an explicit zero source balance without claiming verified clearance or inventing a payment plan", () => {
  const d = input();
  Object.assign(d.contracts[0], {
    signed_date: null,
    registration_basis: "source_record",
    source_reference: "synthetic workbook row65",
    sale_currency: "CNY",
    total_amount_native: 720000,
    total_amount_xof: 0,
    payment_plan_type: "unconfirmed",
    transfer_status: "unconfirmed",
    source_balance_native: 0,
    source_balance_reference: "synthetic workbook K65",
  });
  const row = buildSaleRecordOverview(d)[0];
  expect(row).toMatchObject({
    registeredBalance: { currency: "CNY", amount: 0, sourceRef: "synthetic workbook K65" },
    outstandingNative: null,
    attention: null,
    nextDue: null,
  });
  expect(row.reviewReasons).toContain("payment_arrangement_requires_review");
});
it("flags a source balance conflict while preserving the verified bill's original-currency balance", () => {
  const d = input();
  Object.assign(d.contracts[0], {
    registration_basis: "source_record",
    source_reference: "synthetic workbook row65",
    sale_currency: "CNY",
    total_amount_native: 100,
    total_amount_xof: 0,
    source_balance_native: 0,
    source_balance_reference: "synthetic workbook K65",
  });
  d.receivables = [
    bill({ currency: "CNY", amount_native: 100, paid_amount_native: 20, amount_xof: 0 }),
  ];
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({
    registeredBalance: { currency: "CNY", amount: 0 },
    outstandingNative: [{ currency: "CNY", amount: 80 }],
    attention: { kind: "review", amounts: [] },
    reviewReasons: ["registered_balance_bill_conflict"],
  });
  Object.assign(d.contracts[0], { source_balance_native: 80 });
  d.receivables = [
    ...d.receivables,
    bill({ id: oldId, category: "property_fee", amount_xof: 10, paid_amount_xof: 0 }),
  ];
  const matching = buildSaleRecordOverview(d)[0];
  expect(matching.outstandingNative).toEqual([
    { currency: "CNY", amount: 80 },
    { currency: "XOF", amount: 10 },
  ]);
  expect(matching.reviewReasons).not.toContain("registered_balance_bill_conflict");
  expect(matching.attention?.kind).toBe("overdue");
});
it("keeps source balance evidence independent of historical paid bills and declines assumed currency conversion", () => {
  const d = input();
  Object.assign(d.contracts[0], {
    registration_basis: "source_record",
    source_reference: "synthetic workbook row65",
    source_balance_native: 0,
    source_balance_reference: "synthetic workbook K65",
    status: "terminated",
  });
  d.receivables = [bill({ status: "paid", paid_amount_xof: 1000 })];
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({
    registeredBalance: { currency: "XOF", amount: 0 },
    outstandingNative: [],
    attention: null,
  });
  d.receivables = [
    bill({ currency: "USD", amount_native: 100, paid_amount_native: 0, amount_xof: 58000 }),
  ];
  expect(buildSaleRecordOverview(d)[0]).toMatchObject({
    registeredBalance: { currency: "XOF", amount: 0 },
    outstandingNative: [{ currency: "USD", amount: 100 }],
    attention: { kind: "review" },
    reviewReasons: ["registered_balance_bill_conflict"],
  });
});
it("requires paired, nonnegative source balance evidence and keeps old registrations without it readable", () => {
  const query = parseWorkspaceQuery({ status: "all" });
  const valid = saleFixture(query, "context", 1);
  expect(decodeWorkspace(valid, "sale", query, "context").contracts).toHaveLength(1);
  Object.assign(valid.contracts[0], {
    registration_basis: "source_record",
    source_reference: "synthetic source:row65",
    source_balance_native: 0,
    source_balance_reference: "synthetic source:K65",
  });
  expect(decodeWorkspace(valid, "sale", query, "context").contracts[0]).toMatchObject({
    source_balance_native: 0,
    source_balance_reference: "synthetic source:K65",
  });
  for (const patch of [
    { source_balance_native: null },
    { source_balance_reference: null },
    { source_balance_reference: " " },
    { source_balance_native: -1 },
    { source_balance_native: Infinity },
    { source_balance_native: NaN },
    { source_balance_native: 0.001 },
    { registration_basis: "contract" },
    { source_reference: "" },
  ]) {
    const invalid = structuredClone(valid);
    Object.assign(invalid.contracts[0], patch);
    expect(() => decodeWorkspace(invalid, "sale", query, "context")).toThrow();
  }
});
it("requires explicit source basis for missing signature dates and validates original-currency price fields", () => {
  const query = parseWorkspaceQuery({ status: "all" });
  const valid = saleFixture(query, "context", 1);
  Object.assign(valid.contracts[0], {
    signed_date: null,
    registration_basis: "source_record",
    source_reference: "synthetic source:row65",
    sale_currency: "CNY",
    total_amount_xof: 0,
    total_amount_native: 720000,
  });
  expect(decodeWorkspace(valid, "sale", query, "context").contracts[0]).toMatchObject({
    signed_date: null,
    sale_currency: "CNY",
  });
  for (const patch of [
    { registration_basis: "contract" },
    { source_reference: "" },
    { total_amount_xof: 720000 },
    { total_amount_xof: null },
    { total_amount_native: null },
    { sale_currency: "XOF" },
  ]) {
    const invalid = structuredClone(valid);
    Object.assign(invalid.contracts[0], patch);
    expect(() => decodeWorkspace(invalid, "sale", query, "context")).toThrow();
  }
});
it("rejects missing arrays, duplicate identities and out-of-scope finance evidence", () => {
  const d = input(),
    valid = { payments: [payment()], receivables: [bill()], schedules: [schedule()] };
  expect(decodeSaleRoomFinance(valid, d.contracts, d.units).payments).toHaveLength(1);
  for (const value of [
    { ...valid, payments: undefined },
    { ...valid, receivables: [bill(), bill()] },
    { ...valid, payments: [payment({ source_id: oldId })] },
    { ...valid, schedules: [schedule({ sale_contract_id: oldId })] },
    { ...valid, receivables: [bill({ customer_id: oldCustomer })] },
  ])
    expect(() => decodeSaleRoomFinance(value, d.contracts, d.units)).toThrow(
      "SaleRoomFinanceUnavailable",
    );
});
