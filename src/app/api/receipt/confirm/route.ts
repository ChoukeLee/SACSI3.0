import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!hasPermission(user, "finance:write")) {
      return NextResponse.json({ error: "Finance write permission required" }, { status: 403 });
    }

    const body = await req.json();

    if (!body.room_no) return NextResponse.json({ error: "Room number is required" }, { status: 400 });
    if (!body.receipt_date) return NextResponse.json({ error: "Receipt date is required" }, { status: 400 });
    if (!body.amount_xof || body.amount_xof <= 0) return NextResponse.json({ error: "Valid amount is required" }, { status: 400 });

    const supabase = await createClient();

    const { data: result, error: rpcErr } = await supabase.rpc("confirm_receipt_payment", {
      payload: {
        room_no: body.room_no,
        receipt_no: body.receipt_no ?? null,
        receipt_date: body.receipt_date,
        amount_xof: body.amount_xof,
        currency: body.currency ?? "XOF",
        period_start: body.period_start ?? null,
        period_end: body.period_end ?? null,
        business_type: body.business_type ?? null,
        payer_name: body.payer_name ?? null,
        notes: body.notes ?? null,
        image_path: body.image_path ?? null,
        ocr_text: body.ocr_text ?? null,
        ocr_provider: body.ocr_provider ?? "manual",
        overrideDuplicate: body.overrideDuplicate ?? false,
        actor_id: user.id,
        actor_email: user.email ?? null,
        actor_role: user.role ?? null,
        actor_display_name: user.displayName ?? null,
      },
    });

    if (rpcErr) {
      console.error("confirm_receipt_payment RPC error:", rpcErr);
      return NextResponse.json({ error: "Transaction failed: " + rpcErr.message }, { status: 500 });
    }

    const data = result as Record<string, unknown>;

    // Business failure that isn't duplicate override → return 400
    if (data.success === false && data.requiresOverride !== true) {
      return NextResponse.json(data, { status: 400 });
    }

    revalidatePath("/"); revalidatePath("/fr");
    revalidatePath("/finance"); revalidatePath("/fr/finance");
    revalidatePath("/management"); revalidatePath("/fr/management");
    revalidatePath("/reports"); revalidatePath("/fr/reports");

    return NextResponse.json(data);
  } catch (err) {
    console.error("receipt confirm error", err);
    return NextResponse.json({ error: "Confirmation failed" }, { status: 500 });
  }
}
