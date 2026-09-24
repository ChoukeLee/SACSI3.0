"use server";
import { requireRole } from "@/lib/auth";
import type { LedgerEntryRow } from "@/types/database";
import type { CurrencyCode } from "@/types/domain";
import { submitFinanceOperation } from "./finance-operation-service";

export async function addLedgerEntry(input: {
  buildingId?: string;
  unitId?: string;
  paymentId?: string;
  entryDate: string;
  direction: "income" | "expense" | "liability_in" | "liability_out";
  category: string;
  amount: number;
  currency: CurrencyCode;
  exchangeRateToXof: number;
  description?: string;
  receiptNo?: string;
  requestId: string;
}) {
  await requireRole("admin", "finance");
  const { requestId, ...payload } = input;
  return submitFinanceOperation<LedgerEntryRow>("manual_entry", payload, requestId);
}
