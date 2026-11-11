import { describe, expect, it } from "vitest";
import { summarizeLeaseReceiptKinds } from "@/features/leases/lease-receipt-summary";
import type { LeaseContractRow, LedgerEntryRow, PaymentRow } from "@/types/database";

const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const contract = {
  id: uuid(1),
  unit_id: uuid(2),
  customer_id: uuid(3),
  rent_currency: "XOF",
} as LeaseContractRow;
const payment = (
  n: number,
  source_type: string,
  amount: number,
  changes: Partial<PaymentRow> = {},
) =>
  ({
    id: uuid(n + 10),
    source_id: contract.id,
    source_type,
    amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    native_settlement: false,
    unit_id: contract.unit_id,
    customer_id: contract.customer_id,
    payment_date: "2026-11-08",
    payment_method: "cash",
    reversal_of_payment_id: null,
    request_kind: null,
    ...changes,
  }) as PaymentRow;

describe("lease receipts use the asset cash categories", () => {
  it("separates rent from deposits, agency fees, other cash and refunds without netting rent", () => {
    const rows = [
      payment(1, "lease_rent", 5200000),
      payment(2, "lease_deposit", 1300000),
      payment(3, "lease_agency_income", 650000),
      payment(4, "lease_other_income", 150000),
      payment(5, "property_fee", 50000),
      payment(6, "lease_furniture_income", 50000),
      payment(7, "lease_deposit_refund", 260000),
      payment(8, "lease_rent_refund", 100000),
      payment(9, "lease_agency_expense", 65000),
      payment(10, "lease_other_expense", 25000),
      payment(11, "lease_rent", 900000, { payment_method: "offset" }),
    ];
    const before = JSON.stringify(rows);
    const result = summarizeLeaseReceiptKinds(contract, rows);
    expect(result).toEqual({
      rentReceived: [{ currency: "XOF", amount: 5200000 }],
      verifiedLegacyRentIds: new Set(),
      depositReceived: [{ currency: "XOF", amount: 1300000 }],
      depositReturned: [{ currency: "XOF", amount: 260000 }],
      agencyReceived: [{ currency: "XOF", amount: 650000 }],
      agencyPaid: [{ currency: "XOF", amount: 65000 }],
      otherReceived: [{ currency: "XOF", amount: 250000 }],
      otherPaid: [{ currency: "XOF", amount: 25000 }],
      rentRefunded: [{ currency: "XOF", amount: 100000 }],
      reviewReasons: [],
    });
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("keeps no recorded rent separate from a classified rent amount", () => {
    expect(summarizeLeaseReceiptKinds(contract, []).rentReceived).toEqual([]);
    expect(
      summarizeLeaseReceiptKinds(contract, [payment(1, "lease_agency_income", 650000)])
        .rentReceived,
    ).toEqual([]);
    expect(
      summarizeLeaseReceiptKinds(contract, [
        payment(1, "lease_rent", 500000, { source_id: uuid(99) }),
      ]).rentReceived,
    ).toEqual([]);
  });

  it.each([
    { unit_id: uuid(99) },
    { customer_id: uuid(99) },
    { payment_date: "2026-02-30" },
    { payment_method: "crypto" },
    { amount: 0 },
    { exchange_rate_to_xof: 2 },
  ] as Partial<PaymentRow>[])("keeps invalid or conflicting cash pending review: %j", (changes) => {
    const result = summarizeLeaseReceiptKinds(contract, [
      payment(1, "lease_rent", 5200000, changes),
    ]);
    expect(result.rentReceived).toBeNull();
    expect(result.reviewReasons.length).toBeGreaterThan(0);
  });

  it("does not double count duplicated or reversed original receipts", () => {
    const rent = payment(1, "lease_rent", 5200000);
    expect(summarizeLeaseReceiptKinds(contract, [rent, rent]).rentReceived).toBeNull();
    const reversed = payment(2, "lease_rent", 5200000, { reversal_of_payment_id: rent.id });
    expect(summarizeLeaseReceiptKinds(contract, [rent, reversed]).rentReceived).toBeNull();
  });

  it("does not let another contract's row relabel a selected receipt", () => {
    const rent = payment(1, "lease_rent", 5200000);
    const unrelated = { ...rent, source_id: uuid(99), source_type: "lease_rent_refund" };
    const result = summarizeLeaseReceiptKinds(contract, [rent, unrelated]);
    expect(result.rentReceived).toEqual([{ currency: "XOF", amount: 5200000 }]);
    expect(result.rentRefunded).toEqual([]);
  });

  it("preserves native currency and keeps native deposits and agency separate", () => {
    const native = { ...contract, rent_currency: "USD" } as LeaseContractRow;
    const original = {
      currency: "USD",
      exchange_rate_to_xof: null,
      native_settlement: true,
    } as const;
    const rows = [
      payment(1, "lease_rent", 1000, original),
      payment(2, "lease_deposit", 300, original),
      payment(3, "lease_agency_income", 200, original),
    ];
    const result = summarizeLeaseReceiptKinds(native, rows);
    expect(result.rentReceived).toEqual([{ currency: "USD", amount: 1000 }]);
    expect(result.depositReceived).toEqual([{ currency: "USD", amount: 300 }]);
    expect(result.agencyReceived).toEqual([{ currency: "USD", amount: 200 }]);
    expect(
      summarizeLeaseReceiptKinds(native, [{ ...rows[0], currency: "CNY" }]).rentReceived,
    ).toBeNull();
  });

  it("requires a unique matching ledger purpose for legacy contract cash", () => {
    const rent = payment(1, "lease_contract", 5200000);
    const ledger = {
      id: uuid(90),
      payment_id: rent.id,
      unit_id: contract.unit_id,
      building_id: uuid(4),
      entry_date: rent.payment_date,
      direction: "income",
      category: "lease_rent",
      currency: "XOF",
      amount_xof: rent.amount,
      amount_native: null,
    } as LedgerEntryRow;
    expect(summarizeLeaseReceiptKinds(contract, [rent]).rentReceived).toBeNull();
    expect(
      summarizeLeaseReceiptKinds(contract, [rent], { ledgerEntries: [ledger], buildingId: uuid(4) })
        .rentReceived,
    ).toEqual([{ currency: "XOF", amount: 5200000 }]);
    for (const proof of [
      [ledger, { ...ledger, id: uuid(91) }],
      [{ ...ledger, category: "other_income" }],
      [{ ...ledger, amount_xof: 1 }],
      [{ ...ledger, building_id: uuid(99) }],
    ]) {
      expect(
        summarizeLeaseReceiptKinds(contract, [rent], { ledgerEntries: proof, buildingId: uuid(4) })
          .rentReceived,
      ).toBeNull();
    }
  });
});
