"use server";

import { createClient } from "@/lib/supabase/server";
import { computeStatus } from "@/lib/repositories/receivable-repo";
import type { ReceivableInsert } from "@/types/database";

/**
 * Create a single receivable. Thin wrapper — use from any server action.
 */
export async function createReceivable(input: ReceivableInsert) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("receivables").insert(input).select("*").single();
  if (error) { console.error("createReceivable error:", error); return null; }
  return data;
}

/**
 * Sync all receivables for a given source to match total payments received.
 * Call this AFTER inserting a payment row.
 */
export async function syncReceivablesForSource(sourceType: string, sourceId: string) {
  const supabase = await createClient();

  // Sum payments
  const { data: payments } = await supabase
    .from("payments")
    .select("amount")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);
  const totalPaid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);

  // Get receivables for this source
  const { data: receivables } = await supabase
    .from("receivables")
    .select("*")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .order("due_date");

  if (!receivables || receivables.length === 0) return;

  if (receivables.length === 1) {
    const r = receivables[0];
    if (r.status === "cancelled") return;
    await supabase.from("receivables").update({
      paid_amount_xof: totalPaid,
      status: computeStatus(Number(r.amount_xof), totalPaid, r.due_date),
    }).eq("id", r.id);
  } else {
    // Proportional distribution across multiple receivables
    const totalAmount = receivables.reduce((s, r) => s + Number(r.amount_xof), 0);
    let remaining = totalPaid;
    for (let i = 0; i < receivables.length; i++) {
      const r = receivables[i];
      if (r.status === "cancelled") continue;
      const isLast = i === receivables.length - 1;
      const share = isLast
        ? remaining
        : Math.min(Number(r.amount_xof), Math.round(totalPaid * Number(r.amount_xof) / totalAmount));
      await supabase.from("receivables").update({
        paid_amount_xof: share,
        status: computeStatus(Number(r.amount_xof), share, r.due_date),
      }).eq("id", r.id);
      remaining -= share;
    }
  }
}

/**
 * Update a receivable's amount_xof (e.g. open-ended booking final amount at checkout).
 */
export async function updateReceivableAmount(receivableId: string, newAmountXof: number) {
  const supabase = await createClient();
  const { data: r } = await supabase.from("receivables").select("*").eq("id", receivableId).single();
  if (!r || r.status === "cancelled") return;
  await supabase.from("receivables").update({
    amount_xof: newAmountXof,
    status: computeStatus(newAmountXof, Number(r.paid_amount_xof), r.due_date),
  }).eq("id", receivableId);
}

/**
 * Cancel all receivables for a source (e.g. booking cancelled).
 */
export async function cancelReceivablesForSource(sourceType: string, sourceId: string) {
  const supabase = await createClient();
  await supabase.from("receivables").update({ status: "cancelled" })
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);
}
