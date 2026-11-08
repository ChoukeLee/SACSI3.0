import { describe, expect, it } from "vitest";
import { buildUnitBusinessSummaries } from "@/features/units/unit-business-summary-model";
import {
  matchesUnitWorkbenchFilter,
  type UnitWorkbenchBuilding,
  type UnitWorkbenchPositionRecord,
} from "@/features/units/unit-workbench-model";
import type {
  LedgerEntryRow,
  LeaseContractRow,
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  UnitRow,
} from "@/types/database";

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const building: UnitWorkbenchBuilding = {
  id: id(1),
  code: "SACSI7",
  display_name: "Synthetic building",
  project_id: id(2),
  project_code: "SACSI",
  project_name: "Synthetic project",
  allows_sale: true,
};
const unit = (n = 1): UnitRow => ({
  id: id(100 + n),
  building_id: building.id,
  code: `SYNTHETIC-${n}`,
  unit_no: String(100 + n),
  floor_label: "1F",
  kind: "apartment",
  status: "sold",
  area_sqm: null,
  layout: null,
  furnishing: null,
  notes: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
});
type NamedLease = LeaseContractRow & { customerName: string | null };
type NamedSale = SaleContractRow & { customerName: string | null };
const lease = (n = 1, patch: Partial<NamedLease> = {}): NamedLease => ({
  id: id(200 + n),
  unit_id: unit().id,
  customer_id: id(300 + n),
  customerName: `Synthetic tenant ${n}`,
  contract_no: `SYNTHETIC-LEASE-${n}`,
  start_date: "2026-01-01",
  expected_end_date: "2030-01-01",
  expected_end_confirmed: true,
  actual_end_date: null,
  paid_through_date: "2026-12-31",
  payment_cycle: "monthly",
  payment_day: 1,
  monthly_rent_xof: 100000,
  rent_currency: "XOF",
  monthly_rent_amount: null,
  deposit_amount_xof: 200000,
  deposit_received: false,
  rent_free_days: 0,
  signer_name: null,
  attachment_url: null,
  status: "active",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  ...patch,
});
const sale = (n = 1, patch: Partial<NamedSale> = {}): NamedSale => ({
  id: id(400 + n),
  unit_id: unit().id,
  customer_id: id(500 + n),
  customerName: `Synthetic buyer ${n}`,
  contract_no: `SYNTHETIC-SALE-${n}`,
  signed_date: "2026-01-01",
  total_amount_xof: 1000000,
  sale_currency: "XOF",
  total_amount_native: null,
  total_amount_confirmed: true,
  registration_basis: "contract",
  transfer_date: null,
  transfer_status: "not_started",
  payment_plan_type: "lump_sum",
  title_certificate_no: null,
  agency_company: null,
  agent_name: null,
  agency_commission_amount_xof: null,
  agency_commission_paid: false,
  attachment_url: null,
  status: "active",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  ...patch,
});
const payment = (
  n: number,
  contract: NamedSale | NamedLease,
  patch: Partial<PaymentRow> = {},
): PaymentRow => ({
  id: id(1000 + n),
  source_id: contract.id,
  source_type: "start_date" in contract ? "lease_rent" : "sale_contract",
  unit_id: contract.unit_id,
  customer_id: contract.customer_id,
  payment_date: "2026-10-01",
  amount: 1000,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  native_settlement: false,
  payment_method: "cash",
  request_kind: null,
  reversal_of_payment_id: null,
  receipt_no: null,
  notes: "Synthetic source",
  created_at: "2026-10-01T12:00:00Z",
  ...patch,
});
const ledger = (
  n: number,
  pay: PaymentRow,
  patch: Partial<LedgerEntryRow> = {},
): LedgerEntryRow => ({
  id: id(2000 + n),
  building_id: building.id,
  unit_id: pay.unit_id,
  payment_id: pay.id,
  entry_date: pay.payment_date,
  direction: "income",
  category: pay.source_type,
  amount_xof: pay.native_settlement ? 0 : pay.amount,
  currency: pay.currency,
  amount_native: pay.native_settlement ? pay.amount : null,
  amount_cny: null,
  description: "Synthetic source",
  created_at: "2026-10-01T12:00:00Z",
  ...patch,
});
const bill = (
  n: number,
  contract: NamedSale | NamedLease,
  patch: Partial<ReceivableRow> = {},
): ReceivableRow => ({
  id: id(3000 + n),
  building_id: building.id,
  unit_id: contract.unit_id,
  customer_id: contract.customer_id,
  source_id: contract.id,
  source_type: "start_date" in contract ? "lease_contract" : "sale_contract",
  category: "start_date" in contract ? "lease_rent" : "sale_lump_sum",
  title: "Synthetic bill",
  due_date: "2026-10-01",
  amount_xof: 1000000,
  paid_amount_xof: 0,
  amount_native: null,
  paid_amount_native: null,
  currency: "XOF",
  status: "pending",
  management_status: "managed",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  ...patch,
});
type Input = Parameters<typeof buildUnitBusinessSummaries>[0];
const input = (patch: Partial<Input> = {}): Input => ({
  units: [unit()],
  building,
  sales: [],
  leases: [],
  daily: [],
  payments: [],
  ledger: [],
  receivables: [],
  schedules: [],
  today: "2026-11-08",
  ...patch,
});
const money = (amount: number, currency: "XOF" | "CNY" | "USD" = "XOF") => ({ currency, amount });

describe("asset business financial summaries", () => {
  it("keeps buyer and tenant on their exact room and separates cash, bill allocations, deposits and commissions", () => {
    const sold = sale(),
      rented = lease();
    const payments = [
      payment(1, sold, { amount: 200000 }),
      payment(2, rented, { amount: 300000 }),
      payment(3, rented, { source_type: "lease_deposit", amount: 400000 }),
      payment(4, rented, { source_type: "lease_agency_income", amount: 50000 }),
    ];
    const result = buildUnitBusinessSummaries(
      input({
        units: [unit(), unit(2)],
        sales: [sold],
        leases: [rented],
        payments,
        ledger: payments.map((pay, index) =>
          ledger(index, pay, {
            direction: pay.source_type === "lease_deposit" ? "liability_in" : "income",
          }),
        ),
        receivables: [
          bill(1, sold, { paid_amount_xof: 700000, status: "partial" }),
          bill(2, rented, { amount_xof: 200000, paid_amount_xof: 50000, status: "partial" }),
        ],
      }),
    );
    const summary = result[unit().id];
    expect(summary.status).toBe("ready");
    expect(summary.sales).toHaveLength(1);
    expect(summary.leases).toHaveLength(1);
    expect(summary.sales[0]).toMatchObject({
      recordId: sold.id,
      unitId: unit().id,
      customerId: sold.customer_id,
      customerName: sold.customerName,
    });
    expect(summary.leases[0]).toMatchObject({
      recordId: rented.id,
      unitId: unit().id,
      customerId: rented.customer_id,
      customerName: rented.customerName,
      paidThrough: "2026-12-31",
    });
    expect(summary.sales[0].received).toEqual([money(200000)]);
    expect(summary.sales[0].balance).toMatchObject({
      basis: "verified_bills",
      amounts: [money(300000)],
    });
    expect(summary.leases[0].monthlyRent).toEqual(money(100000));
    expect(summary.leases[0].rentReceived).toEqual([money(300000)]);
    expect(summary.leases[0].rentUnpaid).toEqual([money(150000)]);
    expect(summary.leases[0].depositReceived).toEqual([money(400000)]);
    expect(summary.leases[0].agencyReceived).toEqual([money(50000)]);
    expect(result[unit(2).id].sales).toEqual([]);
    expect(result[unit(2).id].leases).toEqual([]);
  });

  it("does not invent a buyer, tenant, price or debt from an asset status or standalone manual ledger", () => {
    const standalone = ledger(1, payment(1, lease()), {
      payment_id: null,
      category: "lease_rent",
      amount_xof: 900000,
    });
    const summary = buildUnitBusinessSummaries(input({ ledger: [standalone] }))[unit().id];
    expect(summary.sales).toEqual([]);
    expect(summary.leases).toEqual([]);
    expect(summary.daily).toEqual([]);
  });

  it("keeps property fee obligations outside the purchase-price balance", () => {
    const sold = sale();
    const summary = buildUnitBusinessSummaries(
      input({
        sales: [sold],
        receivables: [
          bill(1, sold, { paid_amount_xof: 700000, status: "partial" }),
          bill(2, sold, { category: "property_fee", amount_xof: 100000, paid_amount_xof: 0 }),
        ],
      }),
    )[unit().id];
    expect(summary.sales[0].balance).toMatchObject({
      basis: "verified_bills",
      amounts: [money(300000)],
    });
  });

  it("keeps gross purchase cash above a confirmed same-currency price and includes the discrepancy in attention", () => {
    const sold = sale();
    const payments = [payment(1, sold, { amount: 1000000 }), payment(2, sold, { amount: 1000000 })];
    const summary = buildUnitBusinessSummaries(
      input({ sales: [sold], payments, ledger: payments.map((pay, n) => ledger(n, pay)) }),
    )[unit().id];
    expect(summary.sales[0].total).toEqual(money(1000000));
    expect(summary.sales[0].received).toEqual([money(2000000)]);
    expect(summary.sales[0].reviewReasons).toContain("cash_exceeds_registered_price");
    expect(summary.reviewReasons).toContain("cash_exceeds_registered_price");
    const record: UnitWorkbenchPositionRecord = {
      unit: { occupancy_verified: true, construction_status: "operational" },
      position: {
        ownership: "sold",
        operational_condition: "normal",
        daily_occupied: false,
        lease_occupied: false,
        cleaning_pending: false,
        daily_enabled: false,
        lease_enabled: false,
      },
      business: summary,
    };
    expect(summary.sales[0].balance.basis).toBe("unknown");
    expect(matchesUnitWorkbenchFilter(record, "attention")).toBe(true);
    expect(
      matchesUnitWorkbenchFilter(
        { ...record, business: { ...summary, reviewReasons: [] } },
        "attention",
      ),
    ).toBe(false);
  });

  it.each(["unconfirmed_price", "different_currency"] as const)(
    "does not compare purchase cash numerically against %s",
    (caseName) => {
      const sold = sale(1, { total_amount_confirmed: caseName !== "unconfirmed_price" });
      const pay = payment(1, sold, {
        amount: 2000000,
        currency: caseName === "different_currency" ? "CNY" : "XOF",
        exchange_rate_to_xof: caseName === "different_currency" ? 100 : 1,
      });
      const record = buildUnitBusinessSummaries(
        input({ sales: [sold], payments: [pay], ledger: [ledger(1, pay)] }),
      )[unit().id].sales[0];
      expect(record.received).toEqual([money(2000000, pay.currency as "XOF" | "CNY")]);
      expect(record.reviewReasons).not.toContain("cash_exceeds_registered_price");
    },
  );

  it.each([
    ["XOF", "sale_refund", false],
    ["CNY", "sale_refund", true],
    ["XOF", "sale_agency_expense", true],
  ] as const)(
    "compares price after only explicitly classified same-currency refunds (%s %s)",
    (currency, sourceType, exceeds) => {
      const sold = sale();
      const payments = [
        payment(1, sold, { amount: 1000000 }),
        payment(2, sold, { amount: 1000000 }),
        payment(3, sold, {
          amount: 1000000,
          source_type: sourceType,
          currency,
          exchange_rate_to_xof: currency === "XOF" ? 1 : 100,
        }),
      ];
      const record = buildUnitBusinessSummaries(
        input({
          sales: [sold],
          payments,
          ledger: payments.map((pay, n) =>
            ledger(n, pay, { direction: n === 2 ? "expense" : "income" }),
          ),
        }),
      )[unit().id].sales[0];
      expect(record.received).toEqual([money(2000000)]);
      expect(record.refundPaid).toEqual(
        sourceType === "sale_refund" ? [money(1000000, currency)] : [],
      );
      expect(record.netReceived).toEqual(
        currency !== "XOF" ? null : [money(sourceType === "sale_refund" ? 1000000 : 2000000)],
      );
      expect(record.reviewReasons.includes("refund_currency_or_amount_requires_review")).toBe(
        currency !== "XOF",
      );
      expect(record.reviewReasons.includes("cash_exceeds_registered_price")).toBe(exceeds);
    },
  );

  it.each([1000000, 1100000])(
    "does not hide or clamp an explicit purchase refund of %s",
    (refundAmount) => {
      const sold = sale();
      const payments = [
        payment(1, sold, { amount: 1000000 }),
        payment(2, sold, { amount: refundAmount, source_type: "sale_refund" }),
      ];
      const record = buildUnitBusinessSummaries(
        input({
          sales: [sold],
          payments,
          ledger: payments.map((pay, n) =>
            ledger(n, pay, { direction: n === 1 ? "expense" : "income" }),
          ),
        }),
      )[unit().id].sales[0];
      expect(record.received).toEqual([money(1000000)]);
      expect(record.refundPaid).toEqual([money(refundAmount)]);
      if (refundAmount > 1000000) {
        expect(record.netReceived).toBeNull();
        expect(record.reviewReasons).toContain("refund_currency_or_amount_requires_review");
      } else {
        expect(record.netReceived).toEqual([money(0)]);
        expect(record.reviewReasons).not.toContain("refund_currency_or_amount_requires_review");
      }
    },
  );

  it("does not call a foreign-currency rent bill a verified balance of this lease", () => {
    const rented = lease(1, {
      rent_currency: "USD",
      monthly_rent_xof: 0,
      monthly_rent_amount: 1000,
    });
    const record = buildUnitBusinessSummaries(
      input({
        leases: [rented],
        receivables: [bill(1, rented, { currency: "XOF", amount_xof: 700000 })],
      }),
    )[unit().id].leases[0];
    expect(record.rentUnpaid).toBeNull();
    expect(record.dueUnpaid).toBeNull();
    expect(record.overdue).toBeNull();
    expect(record.reviewReasons.length).toBeGreaterThan(0);
  });

  it("uses the earliest positive verified overdue rent bill date and leaves it unknown if the bill set needs review", () => {
    const rented = lease();
    const bills = [
      bill(1, rented, {
        due_date: "2026-10-01",
        amount_xof: 1000,
        paid_amount_xof: 1000,
        status: "paid",
      }),
      bill(2, rented, {
        due_date: "2026-11-03",
        amount_xof: 1000,
        paid_amount_xof: 500,
        status: "partial",
      }),
      bill(3, rented, {
        due_date: "2026-11-01",
        amount_xof: 1000,
        paid_amount_xof: 800,
        status: "partial",
      }),
      bill(4, rented, { due_date: "2026-11-20", amount_xof: 1000 }),
      bill(5, rented, { due_date: "2026-11-08", amount_xof: 1000 }),
    ];
    const summary = buildUnitBusinessSummaries(input({ leases: [rented], receivables: bills }))[
      unit().id
    ];
    expect(summary.leases[0].overdueDueDate).toBe("2026-11-01");
    expect(summary.leases[0].overdue).toEqual([money(700)]);
    const unknown = buildUnitBusinessSummaries(
      input({
        leases: [rented],
        receivables: [...bills, bill(6, rented, { management_status: "historical_pending" })],
      }),
    )[unit().id].leases[0];
    expect(unknown.overdueDueDate).toBeNull();
    expect(unknown.overdue).toBeNull();
  });

  it("preserves native cash and an explicit source zero balance without inventing FX or verified bills", () => {
    const sold = sale(1, {
      registration_basis: "source_record",
      source_reference: "Synthetic.xlsx|Sheet!A1",
      signed_date: null,
      sale_currency: "CNY",
      total_amount_xof: 0,
      total_amount_native: 720000,
      source_balance_native: 0,
      source_balance_reference: "Synthetic.xlsx|Sheet!B1",
    });
    const rented = lease(1, {
      rent_currency: "USD",
      monthly_rent_xof: 0,
      monthly_rent_amount: 1000,
    });
    const payments = [
      payment(1, sold, {
        amount: 700000,
        currency: "CNY",
        native_settlement: true,
        exchange_rate_to_xof: null,
        payment_method: null,
      }),
      payment(2, sold, {
        amount: 20000,
        currency: "CNY",
        native_settlement: true,
        exchange_rate_to_xof: null,
        payment_method: null,
      }),
      payment(3, rented, {
        amount: 2000,
        currency: "USD",
        native_settlement: true,
        exchange_rate_to_xof: null,
        payment_method: null,
      }),
    ];
    const summary = buildUnitBusinessSummaries(
      input({
        sales: [sold],
        leases: [rented],
        payments,
        ledger: payments.map((pay, n) => ledger(n, pay)),
      }),
    )[unit().id];
    expect(summary.sales[0].total).toEqual(money(720000, "CNY"));
    expect(summary.sales[0].received).toEqual([money(720000, "CNY")]);
    expect(summary.sales[0].netReceived).toEqual([money(720000, "CNY")]);
    expect(summary.sales[0].balance).toMatchObject({
      basis: "registered",
      amounts: [money(0, "CNY")],
      sourceRef: sold.source_balance_reference,
    });
    expect(summary.leases[0].monthlyRent).toEqual(money(1000, "USD"));
    expect(summary.leases[0].rentReceived).toEqual([money(2000, "USD")]);
    expect(summary.leases[0].rentUnpaid).toBeNull();
    expect(summary.leases[0].dueUnpaid).toBeNull();
    expect(summary.leases[0].overdue).toBeNull();
  });

  it("keeps former tenant receipts and debt on that record instead of assigning them to the next tenant", () => {
    const old = lease(1, {
      status: "terminated",
      start_date: "2025-01-01",
      expected_end_date: "2025-12-31",
      actual_end_date: "2025-12-31",
      paid_through_date: "2025-10-31",
    });
    const current = lease(2);
    const payments = [payment(1, old, { amount: 50000 }), payment(2, current, { amount: 100000 })];
    const summary = buildUnitBusinessSummaries(
      input({
        leases: [old, current],
        payments,
        ledger: payments.map((pay, n) => ledger(n, pay)),
        receivables: [
          bill(1, old, { amount_xof: 500000, paid_amount_xof: 50000, status: "partial" }),
          bill(2, current, { amount_xof: 100000, paid_amount_xof: 100000, status: "paid" }),
        ],
      }),
    )[unit().id];
    const prior = summary.leases.find((record) => record.recordId === old.id)!;
    const next = summary.leases.find((record) => record.recordId === current.id)!;
    expect(prior.historical).toBe(true);
    expect(prior.rentUnpaid).toEqual([money(450000)]);
    expect(next.historical).toBe(false);
    expect(next.customerName).toBe(current.customerName);
    expect(next.rentReceived).toEqual([money(100000)]);
    expect(next.rentUnpaid).toEqual([]);
    expect(next.recentReceipts.every((receipt) => receipt.recordId === current.id)).toBe(true);
  });

  it.each(["unit_id", "customer_id"] as const)(
    "does not attribute native purchase cash when its %s is missing",
    (field) => {
      const sold = sale(1, {
        sale_currency: "CNY",
        total_amount_xof: 0,
        total_amount_native: 720000,
      });
      const pay = payment(1, sold, {
        amount: 720000,
        currency: "CNY",
        native_settlement: true,
        exchange_rate_to_xof: null,
        payment_method: null,
        [field]: null,
      });
      const record = buildUnitBusinessSummaries(
        input({ sales: [sold], payments: [pay], ledger: [ledger(1, pay)] }),
      )[unit().id].sales[0];
      expect(record.received).toBeNull();
      expect(record.recentReceipts).toEqual([]);
      expect(record.reviewReasons.length).toBeGreaterThan(0);
    },
  );

  it.each([
    ["2026-11-08", true],
    ["2026-11-23", true],
    ["2026-11-24", false],
  ] as const)(
    "includes the verified due date %s in attention only within fifteen days",
    (due, expected) => {
      const rented = lease();
      const summary = buildUnitBusinessSummaries(
        input({ leases: [rented], receivables: [bill(1, rented, { due_date: due })] }),
      )[unit().id];
      const record: UnitWorkbenchPositionRecord = {
        unit: { occupancy_verified: true, construction_status: "operational" },
        position: {
          ownership: "unspecified",
          operational_condition: "normal",
          daily_occupied: false,
          lease_occupied: true,
          cleaning_pending: false,
          daily_enabled: false,
          lease_enabled: true,
        },
        business: summary,
      };
      expect(matchesUnitWorkbenchFilter(record, "attention")).toBe(expected);
      summary.leases[0].dueUnpaid = null;
      expect(matchesUnitWorkbenchFilter(record, "attention")).toBe(false);
    },
  );

  it.each([false, true])(
    "does not treat an unconfirmed old expected end as a lease-period exception (confirmed=%s)",
    (confirmed) => {
      const rented = lease(1, {
        expected_end_date: "2026-10-31",
        expected_end_confirmed: confirmed,
      });
      const pay = payment(1, rented);
      const future = bill(1, rented, { due_date: "2026-12-01", amount_xof: 1000 });
      const build = (receivables: ReceivableRow[]) =>
        buildUnitBusinessSummaries(
          input({ leases: [rented], payments: [pay], ledger: [ledger(1, pay)], receivables }),
        )[unit().id];
      const summary = build([future]);
      expect(summary.leases[0].rentReceived).toEqual([money(1000)]);
      expect(summary.leases[0].reviewReasons.includes("registered_period_needs_review")).toBe(
        confirmed,
      );
      const record: UnitWorkbenchPositionRecord = {
        unit: { occupancy_verified: true, construction_status: "operational" },
        position: {
          ownership: "unspecified",
          operational_condition: "normal",
          daily_occupied: false,
          lease_occupied: true,
          cleaning_pending: false,
          daily_enabled: false,
          lease_enabled: true,
        },
        business: summary,
      };
      expect(matchesUnitWorkbenchFilter(record, "attention")).toBe(confirmed);
      const actualOverdue = build([
        future,
        bill(2, rented, { due_date: "2026-11-07", amount_xof: 1000 }),
      ]);
      expect(actualOverdue.leases[0].overdue).toEqual([money(1000)]);
      expect(matchesUnitWorkbenchFilter({ ...record, business: actualOverdue }, "attention")).toBe(
        true,
      );
    },
  );

  it.each(["missing", "wrong_amount", "unknown_category"] as const)(
    "does not classify a legacy lease_contract receipt as rent when its ledger evidence is %s",
    (problem) => {
      const rented = lease();
      const pay = payment(1, rented, { source_type: "lease_contract" });
      const rows =
        problem === "missing"
          ? []
          : [
              ledger(1, pay, {
                category: problem === "unknown_category" ? "other" : "lease_rent",
                amount_xof: problem === "wrong_amount" ? 900 : 1000,
              }),
            ];
      const record = buildUnitBusinessSummaries(
        input({ leases: [rented], payments: [pay], ledger: rows }),
      )[unit().id].leases[0];
      expect(record.rentReceived ?? []).toEqual([]);
      expect(record.reviewReasons.length).toBeGreaterThan(0);
    },
  );

  it("classifies a legacy receipt with exact rent ledger evidence once and keeps refunds separate from gross rent", () => {
    const rented = lease();
    const cash = payment(1, rented, { source_type: "lease_contract" });
    const offset = payment(2, rented, { amount: 500, payment_method: "offset" });
    const refund = payment(4, rented, { source_type: "lease_rent_refund", amount: 200 });
    const record = buildUnitBusinessSummaries(
      input({
        leases: [rented],
        payments: [cash, offset, refund],
        ledger: [
          ledger(1, cash, { category: "lease_rent" }),
          ledger(2, offset),
          ledger(4, refund, { direction: "expense" }),
        ],
      }),
    )[unit().id].leases[0];
    expect(record.rentReceived).toEqual([money(1000)]);
    expect(record.refundPaid).toEqual([money(200)]);
    expect(
      record.recentReceipts.some(
        (receipt) =>
          receipt.kind === "refund" && receipt.direction === "out" && receipt.amount.amount === 200,
      ),
    ).toBe(true);
    expect(record.recentReceipts.some((receipt) => receipt.id === offset.id)).toBe(false);
  });

  it("does not present a reversed original and its reversal as healthy rent cash", () => {
    const rented = lease();
    const original = payment(1, rented);
    const reversal = payment(2, rented, { reversal_of_payment_id: original.id });
    const record = buildUnitBusinessSummaries(
      input({
        leases: [rented],
        payments: [original, reversal],
        ledger: [ledger(1, original), ledger(2, reversal)],
      }),
    )[unit().id].leases[0];
    expect(record.rentReceived ?? []).toEqual([]);
    expect(record.reviewReasons.length).toBeGreaterThan(0);
  });

  it("bounds recent receipts but derives the cumulative amount from all matching receipts", () => {
    const rented = lease();
    const payments = Array.from({ length: 15 }, (_, n) =>
      payment(n, rented, {
        amount: 100,
        payment_date: `2026-10-${String(n + 1).padStart(2, "0")}`,
      }),
    );
    const record = buildUnitBusinessSummaries(
      input({ leases: [rented], payments, ledger: payments.map((pay, n) => ledger(n, pay)) }),
    )[unit().id].leases[0];
    expect(record.rentReceived).toEqual([money(1500)]);
    expect(record.receiptCount).toBe(15);
    expect(record.recentReceipts.length).toBeGreaterThan(0);
    expect(record.recentReceipts.length).toBeLessThan(15);
    expect(record.recentReceipts[0].date).toBe("2026-10-15");
    expect(record.recentReceipts.map((receipt) => receipt.date)).toEqual(
      record.recentReceipts
        .map((receipt) => receipt.date)
        .sort()
        .reverse(),
    );
  });

  it("keeps a contaminated cash total unavailable and retains only healthy exact-identity recent receipts", () => {
    const rented = lease();
    const payments = [
      payment(1, rented),
      payment(2, rented, { unit_id: unit(2).id }),
      payment(3, rented, { customer_id: id(999) }),
      payment(4, rented, { source_id: id(998) }),
    ];
    const record = buildUnitBusinessSummaries(
      input({
        units: [unit(), unit(2)],
        leases: [rented],
        payments,
        ledger: payments.map((pay, n) => ledger(n, pay)),
      }),
    )[unit().id].leases[0];
    expect(record.rentReceived).toBeNull();
    expect(record.recentReceipts).toHaveLength(1);
    expect(record.recentReceipts[0]).toMatchObject({
      unitId: unit().id,
      recordId: rented.id,
      amount: money(1000),
    });
    expect(record.reviewReasons.length).toBeGreaterThan(0);
  });
});
