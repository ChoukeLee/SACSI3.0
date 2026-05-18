"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { convertToXof } from "@/lib/currency";
import type { LedgerEntryRow } from "@/types/database";
import type { CurrencyCode } from "@/types/domain";

// ── Add ledger entry (manual) ──

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
}): Promise<{ success: boolean; data?: LedgerEntryRow; error?: string }> {
  const supabase = await createClient();

  const amountXof = convertToXof(input.amount, input.currency, input.exchangeRateToXof);
  const amountCny = input.currency === "CNY" ? input.amount : null;

  const { data, error } = await supabase
    .from("ledger_entries")
    .insert({
      building_id: input.buildingId ?? null,
      unit_id: input.unitId ?? null,
      payment_id: input.paymentId ?? null,
      entry_date: input.entryDate,
      direction: input.direction,
      category: input.category,
      amount_xof: amountXof,
      amount_cny: amountCny,
      description: input.description ?? null,
    })
    .select("*")
    .single();

  if (error) return { success: false, error: error.message };

  // Also record as standalone payment if receipt_no is provided (for manual entries)
  if (input.receiptNo && (input.direction === "income" || input.direction === "liability_in")) {
    await supabase.from("payments").insert({
      source_type: "manual",
      source_id: data.id,
      payment_date: input.entryDate,
      amount: input.amount,
      currency: input.currency,
      exchange_rate_to_xof: input.exchangeRateToXof,
      receipt_no: input.receiptNo,
    });
  }

  await supabase.from("audit_logs").insert({
    action: "create",
    entity_type: "ledger_entry",
    entity_id: data.id,
    metadata: { category: input.category, direction: input.direction, amount_xof: amountXof },
  });

  revalidatePath("/finance");
  revalidatePath("/fr/finance");
  return { success: true, data };
}

// ── CSV export (basic, client-side) ──
// Not a server action — pure string builder, kept separate from "use server" exports.
// Callers can use: buildLedgerCsv(entries) then trigger download client-side.
