import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

const allowedMetrics = new Set([
  "monthly_receivable",
  "monthly_paid",
  "collection_rate",
  "occupancy_rate",
  "daily_occupancy_rate",
  "sale_recovery_rate",
  "vacancy_rate_max",
  "overdue_amount_max",
]);
const allowedPeriods = new Set(["monthly", "quarterly", "yearly"]);
const allowedScopes = new Set(["global", "building", "unit_type", "business_type"]);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !["admin", "boss"].includes(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  const targetValue = Number(body.target_value);
  if (!allowedPeriods.has(body.period_type)) return NextResponse.json({ error: "Invalid period_type" }, { status: 400 });
  if (!allowedMetrics.has(body.metric_key)) return NextResponse.json({ error: "Invalid metric_key" }, { status: 400 });
  if (!allowedScopes.has(body.scope_type ?? "global")) return NextResponse.json({ error: "Invalid scope_type" }, { status: 400 });
  if (!body.period_start || !body.period_end || Number.isNaN(Date.parse(body.period_start)) || Number.isNaN(Date.parse(body.period_end))) {
    return NextResponse.json({ error: "Invalid period range" }, { status: 400 });
  }
  if (!Number.isFinite(targetValue) || targetValue < 0) return NextResponse.json({ error: "Invalid target_value" }, { status: 400 });

  const supabase = await createClient();
  const payload = {
    period_type: body.period_type,
    period_start: body.period_start,
    period_end: body.period_end,
    metric_key: body.metric_key,
    target_value: targetValue,
    unit: body.unit ?? "%",
    scope_type: body.scope_type ?? "global",
    scope_value: body.scope_value ?? null,
    created_by: user.id,
  };
  const { data, error } = await supabase.from("business_targets").insert(payload).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user || !["admin", "boss"].includes(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.from("business_targets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
