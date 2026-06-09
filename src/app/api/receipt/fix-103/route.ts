import { NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";

/** One-time fix for room 103 receipt 0016411 — correct bad OCR data. */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!hasPermission(user, "finance:write")) return NextResponse.json({ error: "Finance write required" }, { status: 403 });

    const supabase = await createClient();
    const corrections: string[] = [];

    // Target values
    const CORRECT = {
      receipt_no: "0016411",
      receipt_date: "2026-06-08",
      period_start: "2026-05-07",
      period_end: "2026-08-06",
      amount_xof: 1950000,
      business_type: "lease_rent",
    };

    // Find unit 103
    const { data: unit } = await supabase.from("units").select("id,building_id").eq("unit_no","103").maybeSingle();
    if (!unit) return NextResponse.json({ error: "Room 103 not found" }, { status: 404 });

    // Find payment by receipt_no
    const { data: payments } = await supabase.from("payments").select("*").eq("receipt_no", CORRECT.receipt_no).limit(3);
    if (!payments || payments.length === 0) {
      // Also try by unit_id + recent date
      const { data: fallback } = await supabase.from("payments").select("*").eq("unit_id", unit.id).order("payment_date",{ascending:false}).limit(5);
      return NextResponse.json({ error: `No payment found for receipt ${CORRECT.receipt_no}`, fallbackPayments: fallback }, { status: 404 });
    }

    const payment = payments[0];
    const paymentId = payment.id;
    const beforeAmount = payment.amount;
    const beforeDate = payment.payment_date;

    // Fix payment
    if (Number(payment.amount) !== CORRECT.amount_xof || payment.payment_date !== CORRECT.receipt_date) {
      const { error: payErr } = await supabase.from("payments").update({
        amount: CORRECT.amount_xof,
        payment_date: CORRECT.receipt_date,
        source_type: "lease_contract",
        notes: `${payment.notes ?? ""} [CORRECTED: amount ${beforeAmount}→${CORRECT.amount_xof}, date ${beforeDate}→${CORRECT.receipt_date}]`.trim(),
      }).eq("id", paymentId);
      if (payErr) return NextResponse.json({ error: `Payment update failed: ${payErr.message}` }, { status: 500 });
      corrections.push(`Payment ${paymentId.slice(0,8)}: amount ${beforeAmount}→${CORRECT.amount_xof}, date ${beforeDate}→${CORRECT.receipt_date}`);
    }

    // Fix ledger entries linked to this payment
    const { data: ledgers } = await supabase.from("ledger_entries").select("*").eq("payment_id", paymentId);
    if (ledgers && ledgers.length > 0) {
      for (const le of ledgers) {
        const leBeforeAmount = Number(le.amount_xof);
        if (leBeforeAmount !== CORRECT.amount_xof || le.entry_date !== CORRECT.receipt_date) {
          await supabase.from("ledger_entries").update({
            amount_xof: CORRECT.amount_xof,
            entry_date: CORRECT.receipt_date,
            description: `Receipt scan: ${CORRECT.receipt_no} | ${CORRECT.period_start}→${CORRECT.period_end} [CORRECTED]`,
          }).eq("id", le.id);
          corrections.push(`Ledger ${le.id.slice(0,8)}: amount ${leBeforeAmount}→${CORRECT.amount_xof}`);
        }
      }
    }

    // Fix attachments metadata
    const { data: attachments } = await supabase.from("attachments").select("*").eq("linked_type","payment").eq("linked_id", paymentId);
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        await supabase.from("attachments").update({
          metadata: {
            ...((att.metadata ?? {}) as Record<string,unknown>),
            receipt_no: CORRECT.receipt_no,
            receipt_date: CORRECT.receipt_date,
            period_start: CORRECT.period_start,
            period_end: CORRECT.period_end,
            amount_xof: CORRECT.amount_xof,
            business_type: CORRECT.business_type,
          },
        }).eq("id", att.id);
        corrections.push(`Attachment ${att.id.slice(0,8)}: metadata corrected`);
      }
    }

    // Fix receivable (adjust paid_amount difference, don't double-count)
    const { data: receivables } = await supabase.from("receivables").select("*").eq("unit_id", unit.id).eq("source_type","lease_contract").neq("status","cancelled").order("due_date",{ascending:false}).limit(3);
    if (receivables && receivables.length > 0) {
      const amountDiff = CORRECT.amount_xof - Number(beforeAmount);
      // Find the receivable with closest amount match to corrected payment
      let bestRec: typeof receivables[0] | null = null;
      let bestDiff = Infinity;
      for (const r of receivables) {
        const diff = Math.abs(Number(r.amount_xof) - CORRECT.amount_xof);
        if (diff < bestDiff) { bestDiff = diff; bestRec = r; }
      }
      if (bestRec && amountDiff !== 0) {
        const newPaid = Number(bestRec.paid_amount_xof) + amountDiff;
        const newStatus = newPaid >= Number(bestRec.amount_xof) ? "paid" : newPaid > 0 ? "partial" : bestRec.status;
        await supabase.from("receivables").update({ paid_amount_xof: newPaid, status: newStatus }).eq("id", bestRec.id);
        corrections.push(`Receivable ${bestRec.id.slice(0,8)}: paid adjusted by ${amountDiff > 0 ? "+" : ""}${amountDiff.toLocaleString()}`);
      }
    }

    // Audit log
    await writeAuditLog({
      action: "receipt_corrected",
      entityType: "payment",
      entityId: paymentId,
      entityLabel: `Room 103 receipt ${CORRECT.receipt_no}`,
      beforeData: { amount: beforeAmount, payment_date: beforeDate },
      afterData: { amount: CORRECT.amount_xof, payment_date: CORRECT.receipt_date, period_start: CORRECT.period_start, period_end: CORRECT.period_end },
      metadata: { reason: "修正103收据0016411金额和周期识别错误", corrections },
    });

    revalidatePath("/"); revalidatePath("/finance"); revalidatePath("/management"); revalidatePath("/reports");
    revalidatePath("/units/103");

    return NextResponse.json({ success: true, corrections, paymentId, correctValues: CORRECT });
  } catch (err) {
    console.error("fix-103 error", err);
    return NextResponse.json({ error: "Fix failed" }, { status: 500 });
  }
}
