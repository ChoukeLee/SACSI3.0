#!/usr/bin/env node

// Stage 2 — fix two known daily-rental financial anomalies (corrected final version).
//
// 1) 902 (booking 45f5b58d): a duplicate 280,000 XOF payment (ff57c09e) was
//    recorded without a ledger entry. Fix: post a reversing payment + reversal
//    ledger, back-fill the duplicate's own ledger, then re-sync to 280,000.
//
// 2) 1105 (booking b23084f3): an open stay (04-24 → 05-26 = 32 nights × 40,000
//    = 1,280,000) was double-collected (2 × 1,200,000 + 40,000 = 2,440,000).
//    Fix: reverse the 1,160,000 excess, set total/final/prepaid to 1,280,000,
//    and create the missing receivable (1,280,000 paid).
//
// Idempotent: every step guards on current state and writes audit_logs.
// Run with a service-role key.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = { ...process.env };
  const envPath = process.env.ENV_FILE ?? join(root, ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const key = t.slice(0, i).trim();
      const value = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!(key in env)) env[key] = value;
    }
  }
  return env;
}

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase URL or service-role key.");
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const today = new Date().toISOString().slice(0, 10);

async function audit(action, entityType, entityId, metadata) {
  const { error } = await db.from("audit_logs").insert({
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata: { ...metadata, source: "stage2-fix-daily-anomalies", fixed_at: new Date().toISOString() },
  });
  if (error) throw new Error(`audit_logs ${action}: ${error.message}`);
}

async function getUnitBuildingId(unitId) {
  const { data } = await db.from("units").select("building_id").eq("id", unitId).single();
  return data?.building_id ?? null;
}

const summary = [];

// ── Fix 1: 902 duplicate payment ──────────────────────────────────────────
const B902 = "45f5b58d-732d-41bd-a640-726f93a4fab5";
const DUP902 = "ff57c09e-5dcc-461b-952e-d07509b6b988";
const REC902 = "7a15f8e7-3d6e-4403-b9ea-8c3e2d156497";

{
  const { data: booking, error } = await db.from("daily_bookings").select("*").eq("id", B902).single();
  if (error) throw new Error("902 booking: " + error.message);

  const { data: dup } = await db.from("payments").select("id").eq("id", DUP902).maybeSingle();
  const { data: existingReversal } = await db.from("payments").select("id").eq("reversal_of_payment_id", DUP902).maybeSingle();

  if (!dup) {
    summary.push({ fix: "902", status: "skipped", reason: "duplicate payment no longer present" });
  } else {
    // a) reverse the duplicate (-280,000)
    if (existingReversal) {
      summary.push({ fix: "902", step: "reversal", status: "skipped", reason: "already exists" });
    } else {
      const { data: reversal, error: rErr } = await db.from("payments").insert({
        customer_id: booking.customer_id,
        unit_id: booking.unit_id,
        source_type: "daily_booking",
        source_id: booking.id,
        payment_date: today,
        amount: -280000,
        currency: "XOF",
        exchange_rate_to_xof: 1,
        receipt_no: null,
        notes: "冲销 2026-05-21 重复收款 280,000（阶段2数据修复）",
        reversal_of_payment_id: DUP902,
        reversal_reason: "重复收款冲正（阶段2数据修复）",
      }).select().single();
      if (rErr) throw new Error("902 reversal: " + rErr.message);

      const bId = await getUnitBuildingId(booking.unit_id);
      const { error: lErr } = await db.from("ledger_entries").insert({
        building_id: bId, unit_id: booking.unit_id, payment_id: reversal.id,
        entry_date: today, direction: "expense", category: "daily_rental",
        amount_xof: 280000, description: "冲销重复收款 房间902",
      });
      if (lErr) throw new Error("902 reversal ledger: " + lErr.message);
      summary.push({ fix: "902", step: "reversal", status: "fixed", reversalPaymentId: reversal.id });
    }

    // b) back-fill the duplicate payment's own missing ledger entry
    const { data: dupLedger } = await db.from("ledger_entries").select("id").eq("payment_id", DUP902).maybeSingle();
    if (dupLedger) {
      summary.push({ fix: "902", step: "duplicate-ledger", status: "skipped", reason: "already exists" });
    } else {
      const bId = await getUnitBuildingId(booking.unit_id);
      const { data: ins, error: lErr } = await db.from("ledger_entries").insert({
        building_id: bId, unit_id: booking.unit_id, payment_id: DUP902,
        entry_date: today, direction: "income", category: "daily_rental",
        amount_xof: 280000, description: "重复收款 房间902（已被冲销）",
      }).select().single();
      if (lErr) throw new Error("902 duplicate ledger: " + lErr.message);
      summary.push({ fix: "902", step: "duplicate-ledger", status: "fixed", ledgerId: ins.id });
    }

    // c) re-sync receivable + booking to 280,000
    await db.from("receivables").update({ paid_amount_xof: 280000, status: "paid" }).eq("id", REC902);
    await db.from("daily_bookings").update({ prepaid_amount_xof: 280000, billing_status: "settled" }).eq("id", booking.id);
    await audit("fix_duplicate_daily_payment", "daily_booking", booking.id, {
      duplicate_payment_id: DUP902,
      amount_xof: 280000,
      note: "重复收款冲正：已收 560,000 → 280,000",
    });
    summary.push({ fix: "902", step: "sync", status: "fixed", prepaid: 280000 });
  }
}

// ── Fix 2: 1105 duplicate + stale amount ──────────────────────────────────
const B1105 = "b23084f3-e363-4fb7-a253-f9724568a196";
const DUP1105 = "01bd1be7-cffe-4970-bfa4-1f8154dc2475"; // second 1,200,000
const CORRECT1105 = 1280000; // 32 nights × 40,000
const EXCESS1105 = 1160000; // 2,440,000 - 1,280,000

{
  const { data: booking, error } = await db.from("daily_bookings").select("*").eq("id", B1105).single();
  if (error) throw new Error("1105 booking: " + error.message);

  // a) reverse the excess
  const { data: existingRev } = await db.from("payments").select("id")
    .eq("source_type", "daily_booking").eq("source_id", B1105).eq("amount", -EXCESS1105).maybeSingle();
  if (existingRev) {
    summary.push({ fix: "1105", step: "reversal", status: "skipped", reason: "already exists" });
  } else {
    const { data: rev, error: rErr } = await db.from("payments").insert({
      customer_id: booking.customer_id,
      unit_id: booking.unit_id,
      source_type: "daily_booking",
      source_id: booking.id,
      payment_date: today,
      amount: -EXCESS1105,
      currency: "XOF",
      exchange_rate_to_xof: 1,
      receipt_no: null,
      notes: "冲销多收 1,160,000（重复收款修正：实际32晚=1,280,000）",
      reversal_of_payment_id: DUP1105,
      reversal_reason: "重复收款冲正（按实际居住日期32晚=1,280,000修正）",
    }).select().single();
    if (rErr) throw new Error("1105 reversal: " + rErr.message);

    const bId = await getUnitBuildingId(booking.unit_id);
    const { error: lErr } = await db.from("ledger_entries").insert({
      building_id: bId, unit_id: booking.unit_id, payment_id: rev.id,
      entry_date: today, direction: "expense", category: "daily_rental",
      amount_xof: EXCESS1105, description: "冲销多收 房间1105（重复收款修正）",
    });
    if (lErr) throw new Error("1105 reversal ledger: " + lErr.message);
    summary.push({ fix: "1105", step: "reversal", status: "fixed", reversalPaymentId: rev.id });
  }

  // b) reconcile booking amount + prepaid to 1,280,000
  if (Number(booking.total_amount_xof) !== CORRECT1105 || Number(booking.final_amount_xof) !== CORRECT1105 || Number(booking.prepaid_amount_xof) !== CORRECT1105) {
    await db.from("daily_bookings").update({
      total_amount_xof: CORRECT1105,
      final_amount_xof: CORRECT1105,
      prepaid_amount_xof: CORRECT1105,
      billing_status: "settled",
      updated_at: new Date().toISOString(),
    }).eq("id", booking.id);
    summary.push({ fix: "1105", step: "booking", status: "fixed", from: booking.total_amount_xof, to: CORRECT1105 });
  } else {
    summary.push({ fix: "1105", step: "booking", status: "already-correct" });
  }

  // c) create/update the receivable to 1,280,000
  const { data: rec } = await db.from("receivables").select("id, amount_xof, paid_amount_xof")
    .eq("source_type", "daily_booking").eq("source_id", booking.id).neq("status", "cancelled").maybeSingle();
  if (rec) {
    if (Number(rec.amount_xof) !== CORRECT1105 || Number(rec.paid_amount_xof) !== CORRECT1105) {
      await db.from("receivables").update({ amount_xof: CORRECT1105, paid_amount_xof: CORRECT1105, status: "paid" }).eq("id", rec.id);
      summary.push({ fix: "1105", step: "receivable", status: "updated", receivableId: rec.id });
    } else {
      summary.push({ fix: "1105", step: "receivable", status: "already-correct" });
    }
  } else {
    const bId = await getUnitBuildingId(booking.unit_id);
    const { data: inserted, error: iErr } = await db.from("receivables").insert({
      building_id: bId, unit_id: booking.unit_id, customer_id: booking.customer_id,
      source_type: "daily_booking", source_id: booking.id, category: "daily_rental",
      title: "日租 1105 2026-04-24", due_date: booking.check_in,
      amount_xof: CORRECT1105, paid_amount_xof: CORRECT1105, status: "paid", currency: "XOF",
      notes: "阶段2数据修复：实际居住32晚=1,280,000，已冲销重复收款",
    }).select().single();
    if (iErr) throw new Error("1105 receivable: " + iErr.message);
    summary.push({ fix: "1105", step: "receivable", status: "created", receivableId: inserted.id });
  }

  await audit("fix_daily_booking_duplicate", "daily_booking", booking.id, {
    correct_amount_xof: CORRECT1105,
    nights: 32,
    excess_reversed_xof: EXCESS1105,
    duplicate_payment_id: DUP1105,
    note: "按实际居住日期(04-24→05-26=32晚×40000)修正为1,280,000，冲销重复收款1,160,000",
  });
}

console.log(JSON.stringify({ today, summary }, null, 2));
