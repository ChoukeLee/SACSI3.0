import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!hasPermission(user, "finance:write")) {
      return NextResponse.json({ error: "Finance write permission required" }, { status: 403 });
    }

    const body = (await req.json()) as ConfirmDraftInput;
    const supabase = await createClient();

    // Validate required fields
    if (!body.room_no) return NextResponse.json({ error: "Room number is required" }, { status: 400 });
    if (!body.receipt_date) return NextResponse.json({ error: "Receipt date is required" }, { status: 400 });
    if (!body.amount_xof || body.amount_xof <= 0) return NextResponse.json({ error: "Valid amount is required" }, { status: 400 });

    // Find the unit
    const { data: unit } = await supabase.from("units").select("id, building_id").eq("unit_no", body.room_no).maybeSingle();
    if (!unit) return NextResponse.json({ error: `Room ${body.room_no} not found` }, { status: 400 });

    // Duplicate check: same receipt_no + year + building_id
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
      }
    }

    const currency = body.currency ?? "XOF";

    // Determine source_type from business_type
    const sourceTypeMap: Record<string, string> = {
      daily_rental: "daily_booking",
      lease_rent: "lease_contract",
      managed_lease_rent: "lease_contract",
      sale: "sale_contract",
    };
    const sourceType = sourceTypeMap[body.business_type ?? ""] ?? "manual";

    // Insert payment
    const { data: payment, error: paymentErr } = await supabase.from("payments").insert({
      unit_id: unit.id,
      customer_id: null,
      source_type: sourceType,
      source_id: null,
      payment_date: body.receipt_date,
      amount: body.amount_xof,
      currency,
      exchange_rate_to_xof: 1,
      receipt_no: body.receipt_no ?? null,
      notes: [
        body.notes,
        duplicateWarning ? `[DUPLICATE WARNING] ${duplicateWarning}` : null,
        body.image_path ? `image:${body.image_path}` : null,
      ].filter(Boolean).join(" | ") || null,
    }).select("id").single();

    if (paymentErr) return NextResponse.json({ error: `Failed to insert payment: ${paymentErr.message}` }, { status: 500 });

    // Insert ledger entry
    await supabase.from("ledger_entries").insert({
      building_id: unit.building_id,
      unit_id: unit.id,
      payment_id: payment.id,
      entry_date: body.receipt_date,
      direction: "income",
      category: body.business_type ?? "manual",
      amount_xof: body.amount_xof,
      description: [
        `Receipt scan confirmed: ${body.receipt_no ?? "no receipt no"}`,
        body.payer_name ? `payer: ${body.payer_name}` : null,
        body.period_start ? `period: ${body.period_start} → ${body.period_end ?? "?"}` : null,
        duplicateWarning ? `[DUPLICATE] ${duplicateWarning}` : null,
      ].filter(Boolean).join(" | "),
    });

    // Audit log
    await supabase.from("audit_logs").insert({
      action: "receipt_scan_confirm",
      entity_type: "payment",
      entity_id: payment.id,
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
        ocr_text: body.ocr_text ? body.ocr_text.slice(0, 500) : null,
        duplicate_warning: duplicateWarning,
        operator: user.displayName ?? user.email,
      },
    });

    // Revalidate
    revalidatePath("/"); revalidatePath("/fr");
    revalidatePath("/finance"); revalidatePath("/fr/finance");
    revalidatePath("/management"); revalidatePath("/fr/management");
    revalidatePath("/reports"); revalidatePath("/fr/reports");

    return NextResponse.json({
      success: true,
      paymentId: payment.id,
      duplicateWarning,
      message: duplicateWarning
        ? `收款已入账，但存在重复提醒：${duplicateWarning}`
        : "收款已确认入账。",
    });
  } catch (err) {
    console.error("receipt confirm error", err);
    return NextResponse.json({ error: "Confirmation failed" }, { status: 500 });
  }
}
