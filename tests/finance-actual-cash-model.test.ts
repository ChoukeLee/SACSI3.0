import { describe, expect, it } from "vitest";
import { buildFinanceActualCash } from "@/features/finance/finance-actual-cash-model";
import type { PaymentRow } from "@/types/database";
import type { OperatingAssetDirectoryData } from "@/features/asset-operations/operating-asset-directory-model";

const payment = {
  id: "p1",
  payment_date: "2026-11-02",
  amount: 100,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  source_type: "lease_contract",
  payment_method: "cash",
  reversal_of_payment_id: null,
  unit_id: "unit",
} as PaymentRow;
const ledger = [
  {
    id: "l1",
    payment_id: "p1",
    entry_date: "2026-11-02",
    direction: "income",
    category: "lease_rent",
    amount_xof: 80,
    building_label: "11#",
    unit_label: "103",
    unit_id: "unit",
  },
  {
    id: "l2",
    payment_id: "p1",
    entry_date: "2026-11-02",
    direction: "liability_in",
    category: "lease_deposit",
    amount_xof: 20,
    building_label: "11#",
    unit_label: "103",
    unit_id: "unit",
  },
];
const scope = { projectId: "sacsi", dateFrom: "2026-11-01", dateTo: "2026-11-30" };
function operations(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "sacsi",
    assets: [{ id: "a1", projectId: "sacsi", unitId: "unit", displayName: "孵化园 B02" }],
    entries: [
      {
        id: "e1",
        assetId: "a1",
        status: "verified",
        kind: "income",
        category: "rent",
        cashDate: "2026-11-02",
        amountNative: 100,
        currency: "XOF",
        bookedAmountXof: 100,
        description: "明确的现金事实",
        ...overrides,
      },
    ],
    canWrite: false,
  } as unknown as OperatingAssetDirectoryData;
}
describe("actual cash proof and identity", () => {
  it("counts a payment linked to rent and deposit entries once while keeping their amounts separate", () => {
    const report = buildFinanceActualCash({ ...scope, ledger, payments: [payment] });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      amountNative: 100,
      kind: "mixed",
      bookedAmountXof: 100,
    });
    expect(report).toMatchObject({
      incomeXof: 80,
      rentIncomeXof: 80,
      depositInXof: 20,
      expenseXof: 0,
    });
    expect(report.nativeTotals).toEqual([{ currency: "XOF", incoming: 100, outgoing: 0 }]);
  });
  it.each([
    { payment_id: "p1", ledger_entry_id: null },
    { payment_id: null, ledger_entry_id: "l2" },
  ])(
    "does not count an operating copy linked to a counted payment or its second ledger component: %j",
    (link) => {
      const report = buildFinanceActualCash({
        ...scope,
        ledger,
        payments: [payment],
        operations: operations(),
        operationLinks: [{ id: "e1", ...link }],
      });
      expect(report.rows).toHaveLength(1);
      expect(report.duplicateOperatingCount).toBe(1);
      expect(report.rentIncomeXof).toBe(80);
    },
  );
  it("keeps independent operating cash even when its asset is linked to a unit", () => {
    const report = buildFinanceActualCash({
      ...scope,
      ledger: [],
      payments: [],
      operations: operations(),
    });
    expect(report.rentIncomeXof).toBe(100);
    expect(report.rows[0].operatingAssetId).toBe("a1");
  });
  it("does not turn standalone entries, offset payments or negative corrections into received cash", () => {
    const report = buildFinanceActualCash({
      ...scope,
      ledger: [ledger[0], { ...ledger[0], id: "standalone", payment_id: null }],
      payments: [{ ...payment, amount: -80 }],
    });
    expect(report.rows).toHaveLength(0);
    expect(report.unverifiedLedgerCount).toBe(2);
    const offset = buildFinanceActualCash({
      ...scope,
      ledger,
      payments: [{ ...payment, payment_method: "offset" }],
    });
    expect(offset.rows).toHaveLength(0);
    expect(offset.excludedNonCashCount).toBe(2);
  });
  it("preserves actual foreign cash without inventing an XOF booking for native settlement", () => {
    const report = buildFinanceActualCash({
      ...scope,
      ledger: [{ ...ledger[0], amount_xof: 0, amount_native: 100, currency: "CNY" }],
      payments: [{ ...payment, currency: "CNY", native_settlement: true }],
    });
    expect(report.rows[0]).toMatchObject({
      amountNative: 100,
      currency: "CNY",
      bookedAmountXof: null,
    });
    expect(report.unknownBookedCount).toBe(1);
    expect(report.rentIncomeXof).toBe(0);
    expect(report.costCoverageComplete).toBe(false);
  });
  it("does not use an unmatched payment or incomplete component sum as a verified receipt", () => {
    const report = buildFinanceActualCash({ ...scope, ledger: [ledger[0]], payments: [payment] });
    expect(report.rows).toHaveLength(0);
    expect(report.unverifiedLedgerCount).toBe(1);
  });
  it("uses actual receipt date even when the linked ledger was posted in a different month", () => {
    const report = buildFinanceActualCash({
      ...scope,
      ledger: ledger.map((row) => ({ ...row, entry_date: "2026-10-30" })),
      payments: [payment],
    });
    expect(report.rows[0].date).toBe("2026-11-02");
    expect(report.rentIncomeXof).toBe(80);
  });
  it("excludes the original payment after a cross-month reversal and does not resurrect an operating copy", () => {
    const report = buildFinanceActualCash({
      ...scope,
      ledger,
      payments: [payment],
      reversedPaymentIds: [payment.id],
      operations: operations(),
      operationLinks: [{ id: "e1", payment_id: payment.id, ledger_entry_id: null }],
    });
    expect(report.rows).toHaveLength(0);
    expect(report.incomeXof).toBe(0);
    expect(report.unverifiedLedgerCount).toBe(3);
  });
  it.each(["daily_credit", "daily_payment_pending", "unknown_import"])(
    "does not classify %s as money received merely from a ledger link",
    (source_type) => {
      const report = buildFinanceActualCash({
        ...scope,
        ledger,
        payments: [{ ...payment, source_type }],
      });
      expect(report.rows).toHaveLength(0);
      expect(report.unverifiedLedgerCount).toBe(2);
    },
  );
});
