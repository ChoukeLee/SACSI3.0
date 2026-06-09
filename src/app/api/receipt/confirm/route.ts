import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";

interface ConfirmDraftInput {
  room_no: string;
  receipt_no?: string | null;
  receipt_date: string;
  amount_xof: number;
  currency?: string;
  period_start?: string | null;
  period_end?: string | null;
  business_type?: string | null;
  payer_name?: string | null;
  notes?: string | null;
  image_path?: string | null;
  ocr_text?: string | null;
  ocr_provider?: string | null;
  overrideDuplicate?: boolean;
}

const sourceTypeMap: Record<string, string> = {
  daily_rental: "daily_booking",
  lease_rent: "lease_contract",
  managed_lease_rent: "lease_contract",
  sale: "sale_contract",
};

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!hasPermission(user, "finance:write")) {
      return NextResponse.json({ error: "Finance write permission required" }, { status: 403 });
    }

    const body = (await req.json()) as ConfirmDraftInput;
    const supabase = await createClient();

    // Validate
    if (!body.room_no) return NextResponse.json({ error: "Room number is required" }, { status: 400 });
    if (!body.receipt_date) return NextResponse.json({ error: "Receipt date is required" }, { status: 400 });
    if (!body.amount_xof || body.amount_xof <= 0) return NextResponse.json({ error: "Valid amount is required" }, { status: 400 });

    const { data: unit } = await supabase.from("units").select("id, building_id").eq("unit_no", body.room_no).maybeSingle();
    if (!unit) return NextResponse.json({ error: `Room ${body.room_no} not found` }, { status: 400 });

    // ═══════════════════════════════════════════════════════
    // 1. Duplicate check — BLOCK unless override
    // ═══════════════════════════════════════════════════════
    let duplicateWarning: string | null = null;
    if (body.receipt_no) {
      const receiptYear = body.receipt_date.slice(0, 4);
      const { data: existing } = await supabase.from("payments")
        .select("id, receipt_no, payment_date, amount")
        .eq("receipt_no", body.receipt_no)
        .gte("payment_date", `${receiptYear}-01-01`)
        .lte("payment_date", `${receiptYear}-12-31`)
        .limit(1);
      if (existing && existing.length > 0) {
        duplicateWarning = `收据号 ${body.receipt_no} 在 ${receiptYear} 年已存在（金额 ${existing[0].amount} XOF，日期 ${existing[0].payment_date}）。`;
        if (!body.overrideDuplicate) {
          return NextResponse.json({
            success: false,
            duplicateWarning,
            requiresOverride: true,
            message: "检测到重复收据号，需要手动确认后才能入账。",
          });
        }
      }
    }

    const currency = body.currency ?? "XOF";
    const sourceType = sourceTypeMap[body.business_type ?? ""] ?? "manual";

    // ═══════════════════════════════════════════════════════
    // 2. Match receivable
    // ═══════════════════════════════════════════════════════
    let matchedReceivableId: string | null = null;
    let unmatchedReceivable = false;

    if (body.business_type && sourceType !== "manual") {
      let receivableQuery = supabase.from("receivables")
        .select("id, source_id, source_type, unit_id, customer_id, amount_xof, paid_amount_xof, status")
        .eq("unit_id", unit.id)
        .eq("source_type", sourceType)
        .neq("status", "paid")
        .neq("status", "cancelled");

      // Try period match first
      if (body.period_start && body.period_end) {
        const { data: periodMatch } = await receivableQuery
          .gte("due_date", body.period_start)
          .lte("due_date", body.period_end)
          .limit(1);
        if (periodMatch && periodMatch.length > 0) {
          matchedReceivableId = periodMatch[0].id;
        }
      }

      // Try amount match
      if (!matchedReceivableId) {
        const { data: amountMatch } = await supabase.from("receivables")
          .select("id, source_id, source_type, unit_id, customer_id, amount_xof, paid_amount_xof, status")
          .eq("unit_id", unit.id)
          .neq("status", "paid")
          .neq("status", "cancelled")
          .order("due_date", { ascending: false })
          .limit(5);
        if (amountMatch && amountMatch.length > 0) {
          // Find the closest by amount
          let best: typeof amountMatch[0] | null = null;
          let bestDiff = Infinity;
          for (const r of amountMatch) {
            const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof);
            const diff = Math.abs(outstanding - body.amount_xof);
            if (diff < bestDiff) { bestDiff = diff; best = r; }
          }
          if (best && bestDiff < body.amount_xof * 0.5) {
            matchedReceivableId = best.id;
          }
        }
      }

      if (!matchedReceivableId) {
        unmatchedReceivable = true;
      }
    }

    // ═══════════════════════════════════════════════════════
    // 3. Insert payment
    // ═══════════════════════════════════════════════════════
    let paymentSourceType = sourceType;
    let paymentSourceId: string | null = null;
    let paymentCustomerId: string | null = null;

    if (matchedReceivableId) {
      const { data: rec } = await supabase.from("receivables")
        .select("source_id, source_type, customer_id")
        .eq("id", matchedReceivableId).single();
      paymentSourceType = rec?.source_type ?? sourceType;
      paymentSourceId = rec?.source_id ?? null;
      paymentCustomerId = rec?.customer_id ?? null;
    }

    const { data: payment, error: paymentErr } = await supabase.from("payments").insert({
      unit_id: unit.id,
      customer_id: paymentCustomerId,
      source_type: paymentSourceType,
      source_id: paymentSourceId,
      payment_date: body.receipt_date,
      amount: body.amount_xof,
      currency,
      exchange_rate_to_xof: 1,
      receipt_no: body.receipt_no ?? null,
      notes: body.notes ?? null,
    }).select("id").single();

    if (paymentErr) return NextResponse.json({ error: `Failed to insert payment: ${paymentErr.message}` }, { status: 500 });

    // Update receivable
    if (matchedReceivableId) {
      const { data: recBefore } = await supabase.from("receivables").select("paid_amount_xof, status").eq("id", matchedReceivableId).single();
      if (recBefore) {
        const newPaid = Number(recBefore.paid_amount_xof) + body.amount_xof;
        let newStatus = recBefore.status;
        if (newPaid >= Number((recBefore as Record<string, unknown>).amount_xof ?? 0)) {
          newStatus = "paid";
        } else if (newPaid > 0) {
          newStatus = "partial";
        }
        await supabase.from("receivables").update({ paid_amount_xof: newPaid, status: newStatus }).eq("id", matchedReceivableId);
      }
    }

    // ═══════════════════════════════════════════════════════
    // 4. Ledger entry
    // ═══════════════════════════════════════════════════════
    await supabase.from("ledger_entries").insert({
      building_id: unit.building_id,
      unit_id: unit.id,
      payment_id: payment.id,
      entry_date: body.receipt_date,
      direction: "income",
      category: body.business_type ?? "manual",
      amount_xof: body.amount_xof,
      description: `Receipt scan: ${body.receipt_no ?? "no receipt no"} | ${body.payer_name ?? ""} ${body.period_start ? `| ${body.period_start}→${body.period_end ?? "?"}` : ""}`.trim(),
    });

    // ═══════════════════════════════════════════════════════
    // 5. Attachment
    // ═══════════════════════════════════════════════════════
    let attachmentId: string | null = null;
    if (body.image_path) {
      const { data: att } = await supabase.from("attachments").insert({
        storage_path: body.image_path,
        bucket: "receipts",
        file_type: "receipt_image",
        linked_type: "payment",
        linked_id: payment.id,
        unit_id: unit.id,
        customer_id: paymentCustomerId,
        uploaded_by: user.id,
        ocr_text: body.ocr_text ?? null,
        ocr_provider: body.ocr_provider ?? "manual",
        metadata: {
          receipt_no: body.receipt_no,
          period_start: body.period_start,
          period_end: body.period_end,
          business_type: body.business_type,
        },
      }).select("id").single();
      if (att) attachmentId = att.id;
    }

    // ═══════════════════════════════════════════════════════
    // 6. Audit log (unified)
    // ═══════════════════════════════════════════════════════
    await writeAuditLog({
      action: "receipt_scan_confirm",
      entityType: "payment",
      entityId: payment.id,
      entityLabel: `Room ${body.room_no} receipt ${body.receipt_no ?? ""}`.trim(),
      metadata: {
        room_no: body.room_no,
        unit_id: unit.id,
        amount_xof: body.amount_xof,
        receipt_no: body.receipt_no,
        receipt_date: body.receipt_date,
        currency,
        business_type: body.business_type,
        payer_name: body.payer_name,
        period_start: body.period_start,
        period_end: body.period_end,
        image_path: body.image_path,
        attachment_id: attachmentId,
        ocr_provider: body.ocr_provider ?? "manual",
        duplicate_override: body.overrideDuplicate ?? false,
        matched_receivable_id: matchedReceivableId,
        unmatched_receivable: unmatchedReceivable,
      },
    });

    revalidatePath("/"); revalidatePath("/fr");
    revalidatePath("/finance"); revalidatePath("/fr/finance");
    revalidatePath("/management"); revalidatePath("/fr/management");
    revalidatePath("/reports"); revalidatePath("/fr/reports");

    return NextResponse.json({
      success: true,
      paymentId: payment.id,
      attachmentId,
      duplicateWarning,
      duplicateOverridden: body.overrideDuplicate ?? false,
      matchedReceivableId,
      unmatchedReceivable,
      message: unmatchedReceivable
        ? "收款已入账，但未匹配到应收款，请人工核对。"
        : "收款已确认入账。",
    });
  } catch (err) {
    console.error("receipt confirm error", err);
    return NextResponse.json({ error: "Confirmation failed" }, { status: 500 });
  }
}
