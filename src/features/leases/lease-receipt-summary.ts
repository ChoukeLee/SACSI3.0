import type { LeaseContractRow, LedgerEntryRow, PaymentRow } from "@/types/database";
import {
  projectUnitRecordCash,
  type UnitBusinessMoney,
} from "@/features/units/unit-business-summary-model";

export interface LeaseReceiptSummary {
  rentReceived: UnitBusinessMoney[] | null;
  verifiedLegacyRentIds: ReadonlySet<string>;
  depositReceived: UnitBusinessMoney[] | null;
  depositReturned: UnitBusinessMoney[] | null;
  agencyReceived: UnitBusinessMoney[] | null;
  agencyPaid: UnitBusinessMoney[] | null;
  otherReceived: UnitBusinessMoney[] | null;
  otherPaid: UnitBusinessMoney[] | null;
  rentRefunded: UnitBusinessMoney[] | null;
  reviewReasons: string[];
}

/** The asset view and selected lease use the same original-currency cash classification. */
export function summarizeLeaseReceiptKinds(
  contract: LeaseContractRow,
  payments: readonly PaymentRow[],
  options: { ledgerEntries?: readonly LedgerEntryRow[]; buildingId?: string } = {},
): LeaseReceiptSummary {
  const cash = projectUnitRecordCash(
    { payments, ledger: options.ledgerEntries ?? [], building: { id: options.buildingId } },
    contract,
    "lease",
  );
  const rentReceived = cash.total("rent");
  const sourceTypes = new Map(
    payments
      .filter((payment) => payment.source_id === contract.id)
      .map((payment) => [payment.id, payment.source_type]),
  );
  const bySource = (sourceType: string): UnitBusinessMoney[] | null => {
    if (rentReceived === null) return null;
    const totals = new Map<UnitBusinessMoney["currency"], number>();
    for (const receipt of cash.rows.filter((row) => sourceTypes.get(row.id) === sourceType))
      totals.set(
        receipt.amount.currency,
        (totals.get(receipt.amount.currency) ?? 0) + Math.round(receipt.amount.amount * 100),
      );
    return [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => ({ currency, amount: amount / 100 }));
  };
  return {
    rentReceived,
    verifiedLegacyRentIds: new Set(
      cash.rows
        .filter((row) => row.kind === "rent" && sourceTypes.get(row.id) === "lease_contract")
        .map((row) => row.id),
    ),
    depositReceived: cash.total("deposit"),
    depositReturned: bySource("lease_deposit_refund"),
    agencyReceived: cash.total("agency"),
    agencyPaid: bySource("lease_agency_expense"),
    otherReceived: cash.total("other"),
    otherPaid: bySource("lease_other_expense"),
    rentRefunded: bySource("lease_rent_refund"),
    reviewReasons: [...new Set(cash.reviews)],
  };
}
