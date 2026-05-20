"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { sortUnits } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";
import { createReceivable, cancelReceivablesForSource } from "@/features/finance/receivables";
import type { BulkActionType, BulkPreview, PreviewRow, BulkResult } from "./bulk-action-types";

const today = new Date().toISOString().slice(0, 10);
const monthPrefix = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

function csvLine(fields: (string | number | null | undefined)[]): string {
  return fields.map(f => { const s = String(f ?? ""); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; }).join(",");
}

async function statusAfterCancellingDailyBooking(
  supabase: Awaited<ReturnType<typeof createClient>>,
  unitId: string,
  cancelledBookingId: string,
  currentStatus: string,
): Promise<string> {
  const [{ data: activeSale }, { data: activeLease }, { data: checkedIn }, { data: reserved }] = await Promise.all([
    supabase.from("sale_contracts").select("id").eq("unit_id", unitId).eq("status", "active").limit(1),
    supabase.from("lease_contracts").select("id").eq("unit_id", unitId).eq("status", "active").limit(1),
    supabase.from("daily_bookings").select("id").eq("unit_id", unitId).eq("status", "checked_in").neq("id", cancelledBookingId).limit(1),
    supabase.from("daily_bookings").select("id").eq("unit_id", unitId).in("status", ["pending_review", "confirmed"]).neq("id", cancelledBookingId).limit(1),
  ]);

  if ((activeSale?.length ?? 0) > 0) return "sold";
  if ((activeLease?.length ?? 0) > 0) return "leased";
  if ((checkedIn?.length ?? 0) > 0) return "daily_occupied";
  if ((reserved?.length ?? 0) > 0) return "reserved";
  if (currentStatus === "maintenance" || currentStatus === "locked" || currentStatus === "cleaning_pending") return currentStatus;
  return "available";
}

export async function buildPreview(action: BulkActionType, ids: string[], extra?: Record<string, string>): Promise<BulkPreview> {
  const supabase = await createClient();
  const rows: PreviewRow[] = [];
  const warnings: string[] = [];
  let totalAmount = 0;
  const unitIds = new Set<string>();
  const custIds = new Set<string>();

  switch (action) {
    case "unit_change_status": {
      const targetStatus = extra?.targetStatus ?? "available";
      const { data: units } = await supabase.from("units").select("*").order("unit_no").limit(500);
      for (const u of sortUnits(units ?? [])) {
        if (ids.length > 0 && !ids.includes(u.id)) continue;
        unitIds.add(u.id);
        // Safety checks
        const hasActiveDay = await supabase.from("daily_bookings").select("id").eq("unit_id", u.id).eq("status", "checked_in").limit(1);
        const hasActiveLease = await supabase.from("lease_contracts").select("id").eq("unit_id", u.id).eq("status", "active").limit(1);
        const hasActiveSale = await supabase.from("sale_contracts").select("id").eq("unit_id", u.id).eq("status", "active").limit(1);
        const blocked = (hasActiveDay.data && hasActiveDay.data.length > 0) || (hasActiveLease.data && hasActiveLease.data.length > 0) || (hasActiveSale.data && hasActiveSale.data.length > 0);
        if (targetStatus === "available" && blocked) {
          rows.push({ id: u.id, label: `${u.unit_no} (${u.status})`, willChange: false, skipReason: `有活跃业务占用`, metadata: { status: u.status } });
        } else if (u.status === targetStatus) {
          rows.push({ id: u.id, label: u.unit_no, willChange: false, skipReason: "已是目标状态", metadata: {} });
        } else {
          rows.push({ id: u.id, label: `${u.unit_no} (${u.status} → ${targetStatus})`, willChange: true, skipReason: "", metadata: { from: u.status, to: targetStatus } });
        }
      }
      break;
    }
    case "daily_confirm_bookings": {
      const { data: bookings } = await supabase.from("daily_bookings").select("*").eq("status", "pending_review").order("check_in").limit(300);
      for (const b of (bookings ?? [])) {
        if (ids.length > 0 && !ids.includes(b.id)) continue;
        unitIds.add(b.unit_id); custIds.add(b.customer_id ?? "");
        if (b.status !== "pending_review") rows.push({ id: b.id, label: `${b.check_in}`, willChange: false, skipReason: "状态不是 pending_review", metadata: {} });
        else rows.push({ id: b.id, label: `${b.check_in}`, willChange: true, skipReason: "", metadata: {} });
      }
      break;
    }
    case "daily_cancel_bookings": {
      const reason = extra?.reason ?? "";
      const { data: bookings } = await supabase.from("daily_bookings").select("*").eq("status", "pending_review").order("check_in").limit(300);
      for (const b of (bookings ?? [])) {
        if (ids.length > 0 && !ids.includes(b.id)) continue;
        unitIds.add(b.unit_id); custIds.add(b.customer_id ?? "");
        if (b.status !== "pending_review") rows.push({ id: b.id, label: `${b.check_in}`, willChange: false, skipReason: "状态不是 pending_review", metadata: {} });
        else if (!reason) rows.push({ id: b.id, label: `${b.check_in}`, willChange: false, skipReason: "缺少取消原因", metadata: {} });
        else rows.push({ id: b.id, label: `${b.check_in}`, willChange: true, skipReason: "", metadata: { reason } });
      }
      break;
    }
    case "finance_confirm_payments": {
      const { data: recs } = await supabase.from("receivables").select("*").neq("status", "cancelled").neq("status", "paid").order("due_date").limit(500);
      for (const r of (recs ?? [])) {
        if (ids.length > 0 && !ids.includes(r.id)) continue;
        unitIds.add(r.unit_id ?? ""); custIds.add(r.customer_id ?? "");
        const unpaid = Number(r.amount_xof) - Number(r.paid_amount_xof);
        totalAmount += unpaid;
        if (unpaid <= 0) rows.push({ id: r.id, label: r.title, willChange: false, skipReason: "已结清", metadata: {} });
        else rows.push({ id: r.id, label: `${r.title} (${unpaid})`, willChange: true, skipReason: "", metadata: { unpaid: String(unpaid) } });
      }
      break;
    }
    case "lease_gen_receivables": {
      const { data: contracts } = await supabase.from("lease_contracts").select("*, units(unit_no)").eq("status", "active").limit(200);
      for (const c of (contracts ?? [])) {
        if (ids.length > 0 && !ids.includes(c.id)) continue;
        unitIds.add(c.unit_id);
        const { data: existing } = await supabase.from("receivables").select("id").eq("source_type", "lease_contract").eq("source_id", c.id).eq("category", "lease_rent").gte("due_date", today).limit(1);
        if (existing && existing.length > 0) {
          rows.push({ id: c.id, label: `${c.contract_no}`, willChange: false, skipReason: "本月应收已存在", metadata: {} });
        } else {
          const unit = (c as any).units as { unit_no: string } | null;
          rows.push({ id: c.id, label: `${c.contract_no} (${unit?.unit_no ?? ""})`, willChange: true, skipReason: "", metadata: { monthly_rent: String(c.monthly_rent_xof) } });
          totalAmount += Number(c.monthly_rent_xof);
        }
      }
      break;
    }
    case "sale_gen_receivables": {
      const { data: contracts } = await supabase.from("sale_contracts").select("*, units(unit_no)").eq("status", "active").limit(200);
      for (const c of (contracts ?? [])) {
        if (ids.length > 0 && !ids.includes(c.id)) continue;
        unitIds.add(c.unit_id);
        if (c.payment_plan_type === "lump_sum") { rows.push({ id: c.id, label: c.contract_no, willChange: false, skipReason: "一次性付款已生成", metadata: {} }); continue; }
        const { data: sched } = await supabase.from("sale_payment_schedule").select("id").eq("sale_contract_id", c.id).eq("status", "pending").order("due_date").limit(1);
        if (!sched || sched.length === 0) { rows.push({ id: c.id, label: c.contract_no, willChange: false, skipReason: "无待生成分期", metadata: {} }); continue; }
        const next = sched[0];
        const { data: existingRec } = await supabase.from("receivables").select("id").eq("source_type", "sale_contract").eq("source_id", c.id).eq("category", "sale_installment").gte("due_date", today).limit(1);
        if (existingRec && existingRec.length > 0) rows.push({ id: c.id, label: c.contract_no, willChange: false, skipReason: "下期应收已存在", metadata: {} });
        else rows.push({ id: c.id, label: c.contract_no, willChange: true, skipReason: "", metadata: {} });
      }
      break;
    }
    case "daily_export_checkins":
    case "daily_export_checkouts":
    case "finance_export_dunning":
    case "customer_export_filtered": {
      let bookings: any[] = [];
      if (action === "daily_export_checkins") {
        const { data } = await supabase.from("daily_bookings").select("*, units(unit_no), customers(name)").eq("check_in", today).in("status", ["pending_review", "confirmed"]).limit(200);
        bookings = (data ?? []) as any[];
      } else if (action === "daily_export_checkouts") {
        const { data } = await supabase.from("daily_bookings").select("*, units(unit_no), customers(name)").or(`check_out.eq.${today},and(checkout_mode.eq.open,status.eq.checked_in)`).limit(200);
        bookings = (data ?? []) as any[];
      }
      for (const b of bookings) {
        if (ids.length > 0 && !ids.includes(b.id)) continue;
        const unit = (b as any).units as { unit_no: string } | null;
        const cust = (b as any).customers as { name: string } | null;
        rows.push({ id: b.id, label: `${unit?.unit_no ?? ""} ${cust?.name ?? ""} ${b.check_in}`, willChange: true, skipReason: "", metadata: { unit: unit?.unit_no ?? "", customer: cust?.name ?? "", check_in: b.check_in } });
      }
      break;
    }
    default: break;
  }

  return { action, rows, changeCount: rows.filter(r => r.willChange).length, skipCount: rows.filter(r => !r.willChange).length, totalAmount, unitCount: unitIds.size, customerCount: custIds.size, warnings };
}

export async function executeBulk(action: BulkActionType, ids: string[], extra?: Record<string, string>): Promise<BulkResult> {
  const user = await getCurrentUser();
  const supabase = await createClient();
  let executed = 0, failed = 0, skipped = 0;
  const errors: string[] = [];

  try {
    switch (action) {
      case "unit_change_status": {
        const targetStatus = extra?.targetStatus ?? "available";
        for (const id of ids) {
          try {
            const { data: unit } = await supabase.from("units").select("*").eq("id", id).single();
            if (!unit) { skipped++; continue; }
            if (unit.status === targetStatus) { skipped++; continue; }
            const hasActive = await supabase.from("daily_bookings").select("id").eq("unit_id", id).eq("status", "checked_in").limit(1);
            const hasLease = await supabase.from("lease_contracts").select("id").eq("unit_id", id).eq("status", "active").limit(1);
            const hasSale = await supabase.from("sale_contracts").select("id").eq("unit_id", id).eq("status", "active").limit(1);
            if (targetStatus === "available" && ((hasActive.data?.length ?? 0) > 0 || (hasLease.data?.length ?? 0) > 0 || (hasSale.data?.length ?? 0) > 0)) {
              skipped++; errors.push(`${unit.unit_no}: 有活跃业务占用，跳过`);
              continue;
            }
            await supabase.from("units").update({ status: targetStatus }).eq("id", id);
            executed++;
          } catch (e: unknown) { failed++; errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        break;
      }
      case "daily_confirm_bookings": {
        for (const id of ids) {
          try {
            const { error } = await supabase.from("daily_bookings").update({ status: "confirmed" }).eq("id", id).eq("status", "pending_review");
            if (error) { failed++; errors.push(`${id}: ${error.message}`); } else executed++;
          } catch (e: unknown) { failed++; errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        break;
      }
      case "daily_cancel_bookings": {
        const reason = extra?.reason ?? "批量取消";
        for (const id of ids) {
          try {
            const { error } = await supabase.from("daily_bookings").update({ status: "cancelled" }).eq("id", id).eq("status", "pending_review");
            if (error) { failed++; errors.push(`${id}: ${error.message}`); } else {
              const { data: b } = await supabase.from("daily_bookings").select("unit_id, units(status)").eq("id", id).single();
              if (b) {
                const unit = (b as unknown as { units: { status: string } | null }).units;
                const nextStatus = await statusAfterCancellingDailyBooking(supabase, b.unit_id, id, unit?.status ?? "available");
                await supabase.from("units").update({ status: nextStatus }).eq("id", b.unit_id);
              }
              await cancelReceivablesForSource("daily_booking", id);
              executed++;
            }
          } catch (e: unknown) { failed++; errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        break;
      }
      case "finance_confirm_payments": {
        for (const id of ids) {
          try {
            const { data: rec } = await supabase.from("receivables").select("*").eq("id", id).single();
            if (!rec) { skipped++; continue; }
            const unpaid = Number(rec.amount_xof) - Number(rec.paid_amount_xof);
            if (unpaid <= 0) { skipped++; continue; }
            await supabase.from("payments").insert({ customer_id: rec.customer_id, unit_id: rec.unit_id, source_type: rec.source_type, source_id: rec.source_id, payment_date: today, amount: unpaid, currency: "XOF", exchange_rate_to_xof: 1 });
            await supabase.from("receivables").update({ paid_amount_xof: Number(rec.amount_xof), status: "paid" }).eq("id", id);
            executed++;
          } catch (e: unknown) { failed++; errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        break;
      }
      case "lease_gen_receivables": {
        for (const id of ids) {
          try {
            const { data: c } = await supabase.from("lease_contracts").select("*, units(unit_no, building_id)").eq("id", id).single();
            if (!c) { skipped++; continue; }
            const unit = (c as any).units as { unit_no: string; building_id: string } | null;
            const amount = Number(c.monthly_rent_xof);
            const dueDate = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(Math.min(c.payment_day, 28)).padStart(2, "0")}`;
            await createReceivable({ building_id: unit?.building_id ?? null, unit_id: c.unit_id, customer_id: c.customer_id, source_type: "lease_contract", source_id: c.id, category: "lease_rent", title: `长租租金 ${unit?.unit_no ?? ""} ${monthPrefix}`, due_date: dueDate, amount_xof: amount, paid_amount_xof: 0, status: "pending", currency: "XOF" });
            executed++;
          } catch (e: unknown) { failed++; errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        break;
      }
      case "sale_gen_receivables": {
        for (const id of ids) {
          try {
            const { data: sc } = await supabase.from("sale_contracts").select("*, units(unit_no, building_id)").eq("id", id).single();
            if (!sc) { skipped++; continue; }
            const { data: sched } = await supabase.from("sale_payment_schedule").select("*").eq("sale_contract_id", id).eq("status", "pending").order("due_date").limit(1);
            if (!sched || sched.length === 0) { skipped++; continue; }
            const s = sched[0];
            const unit = (sc as any).units as { unit_no: string; building_id: string } | null;
            await createReceivable({ building_id: unit?.building_id ?? null, unit_id: sc.unit_id, customer_id: sc.customer_id, source_type: "sale_contract", source_id: sc.id, category: "sale_installment", title: `出售分期 ${sc.contract_no} 第${s.installment_no}期`, due_date: s.due_date, amount_xof: Number(s.amount_xof), paid_amount_xof: 0, status: "pending", currency: "XOF" });
            executed++;
          } catch (e: unknown) { failed++; errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        break;
      }
      case "daily_export_checkins":
      case "daily_export_checkouts":
      case "finance_export_dunning":
      case "customer_export_filtered": {
        exported = await generateExportCsv(action, ids);
        executed = exported > 0 ? exported : 0;
        break;
      }
      default: break;
    }

    await writeAuditLog({
      action: "bulk_action", entityType: action, entityId: null,
      entityLabel: `批量操作 ${action}`,
      metadata: { executed, failed, skipped, ids, extra, actor: user?.email },
    });
  } catch (e: unknown) {
    errors.push(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  }

  const success = failed === 0 && errors.length === 0;
  return { success, action, executed, failed, skipped, errors };
}

let exported = 0;

async function generateExportCsv(action: BulkActionType, ids: string[]): Promise<number> {
  const supabase = await createClient();
  const rows: string[] = [];
  switch (action) {
    case "daily_export_checkins": {
      rows.push("房号,客户,入住日期,状态");
      const { data } = await supabase.from("daily_bookings").select("*, units(unit_no), customers(name)").eq("check_in", today).in("status", ["pending_review", "confirmed"]).limit(300);
      for (const b of (data ?? [])) {
        if (ids.length > 0 && !ids.includes(b.id)) continue;
        const unit = (b as any).units as { unit_no: string } | null;
        const cust = (b as any).customers as { name: string } | null;
        rows.push(csvLine([unit?.unit_no ?? "", cust?.name ?? "", b.check_in, b.status]));
      }
      break;
    }
    case "daily_export_checkouts": {
      rows.push("房号,客户,预计退房,状态");
      const { data } = await supabase.from("daily_bookings").select("*, units(unit_no), customers(name)").or(`check_out.eq.${today},and(checkout_mode.eq.open,status.eq.checked_in)`).limit(300);
      for (const b of (data ?? [])) {
        if (ids.length > 0 && !ids.includes(b.id)) continue;
        const unit = (b as any).units as { unit_no: string } | null;
        const cust = (b as any).customers as { name: string } | null;
        rows.push(csvLine([unit?.unit_no ?? "", cust?.name ?? "", b.check_out ?? "开放式", b.status]));
      }
      break;
    }
    case "finance_export_dunning": {
      rows.push("房号,客户,应收金额,未收金额,到期日,标题");
      const { data } = await supabase.from("receivables").select("*, units(unit_no), customers(name)").or("status.eq.overdue,and(due_date.lt." + today + ",status.neq.paid,status.neq.cancelled)").limit(500);
      for (const r of (data ?? [])) {
        if (ids.length > 0 && !ids.includes(r.id)) continue;
        const unit = (r as any).units as { unit_no: string } | null;
        const cust = (r as any).customers as { name: string } | null;
        const unpaid = Number(r.amount_xof) - Number(r.paid_amount_xof);
        rows.push(csvLine([unit?.unit_no ?? "", cust?.name ?? "", r.amount_xof, unpaid, r.due_date, r.title]));
      }
      break;
    }
    default: break;
  }
  if (rows.length > 1) {
    const csv = rows.join("\n");
    // Can't download from server action directly, return via response
    // For v1, we return the row count; the client receives it as a text response
    return rows.length - 1;
  }
  return 0;
}
