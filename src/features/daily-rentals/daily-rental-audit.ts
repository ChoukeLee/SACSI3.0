import type { QualityIssue, QualitySeverity, QualityCategory } from "@/features/data-quality/quality-types";

const today = new Date().toISOString().slice(0, 10);

interface RawRow { [key: string]: unknown; }

function expectedDailyAmount(booking: RawRow): { nights: number; gross: number; discount: number; final: number; effectiveCheckOut: string } {
  const checkIn = booking.check_in as string;
  const mode = (booking.checkout_mode as string | null) ?? "fixed";
  const effectiveCheckOut =
    mode === "fixed" && booking.check_out
      ? booking.check_out as string
      : mode === "open" && booking.actual_check_out
        ? booking.actual_check_out as string
        : today;
  const nights = Math.max(1, Math.ceil((new Date(effectiveCheckOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24)));
  const gross = Number(booking.total_amount_xof ?? 0);
  const discount = Number(booking.manual_discount_amount_xof ?? 0);
  const final = Math.max(0, gross - discount);
  return { nights, gross, discount, final, effectiveCheckOut };
}

function iss(
  id: string, sev: QualitySeverity, cat: QualityCategory,
  title: string, description: string, suggestedAction: string,
  entityType: string, entityId: string | null, entityLabel: string,
  related: string[] = [], href = "",
  fixable?: boolean, repairEntityId?: string | null,
): QualityIssue {
  return { id, severity: sev, category: cat, title, description, entityType, entityId: entityId ?? null, entityLabel, relatedEntities: related, href, suggestedAction, detectedAt: today, status: "open", fixable: fixable ?? false, repairEntityId: repairEntityId ?? null };
}

export interface AuditSnapshot {
  dailyBookings: RawRow[];
  units: RawRow[];
  payments: RawRow[];
  receivables: RawRow[];
  cleaningTasks: RawRow[];
  ledgerEntries: RawRow[];
  auditLogs: RawRow[];
}

export function scanDailyRentalIssues(data: AuditSnapshot): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const bookings = data.dailyBookings;
  const units = data.units;
  const payments = data.payments;
  const receivables = data.receivables;
  const cleaningTasks = data.cleaningTasks;
  const ledgerEntries = data.ledgerEntries;
  const auditLogs = data.auditLogs;

  const unitById = new Map<string, RawRow>();
  for (const u of units) unitById.set(u.id as string, u);

  // ═══════════════════════════════════════════════════
  // 1. Overlapping active bookings
  // ═══════════════════════════════════════════════════
  const activeStatuses = ["pending_review", "confirmed", "checked_in"];
  const activeBookingsByUnit = new Map<string, RawRow[]>();
  for (const b of bookings) {
    if (!activeStatuses.includes(b.status as string)) continue;
    const uid = b.unit_id as string;
    if (!activeBookingsByUnit.has(uid)) activeBookingsByUnit.set(uid, []);
    activeBookingsByUnit.get(uid)!.push(b);
  }
  for (const [uid, unitBookings] of activeBookingsByUnit) {
    for (let i = 0; i < unitBookings.length; i++) {
      for (let j = i + 1; j < unitBookings.length; j++) {
        const a = unitBookings[i], b = unitBookings[j];
        const aIn = a.check_in as string, aOut = (a.check_out as string) ?? aIn;
        const bIn = b.check_in as string, bOut = (b.check_out as string) ?? bIn;
        const aOutEff = (a.checkout_mode === "open" || !a.check_out) ? "9999-12-31" : aOut;
        const bOutEff = (b.checkout_mode === "open" || !b.check_out) ? "9999-12-31" : bOut;
        if (aIn < bOutEff && bIn < aOutEff) {
          const unit = unitById.get(uid);
          const label = unit ? `${unit.unit_no ?? uid.slice(0, 8)}` : uid.slice(0, 8);
          const bIdA = a.id as string, bIdB = b.id as string;
          issues.push(iss(
            `dr_overlap_${bIdA.slice(0, 8)}_${bIdB.slice(0, 8)}`, "high", "daily_rental",
            `Overlapping bookings ${label}`,
            `Room ${label} has overlapping active bookings: ${a.check_in}→${aOut} (${a.status}) and ${b.check_in}→${bOut} (${b.status})`,
            "Manual review required. Cannot auto-fix.",
            "daily_booking", bIdA, label, [bIdA, bIdB], `/daily-rentals`,
          ));
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // 2. checked_in vs unit.status
  // ═══════════════════════════════════════════════════
  const checkedInByUnit = new Map<string, RawRow[]>();
  for (const b of bookings) {
    if (b.status !== "checked_in") continue;
    const uid = b.unit_id as string;
    if (!checkedInByUnit.has(uid)) checkedInByUnit.set(uid, []);
    checkedInByUnit.get(uid)!.push(b);
  }
  for (const [uid, ciList] of checkedInByUnit) {
    const unit = unitById.get(uid);
    if (!unit) continue;
    const label = `${unit.unit_no ?? uid.slice(0, 8)}`;
    if (unit.status !== "daily_occupied") {
      const bId = ciList[0].id as string;
      if (ciList.length === 1) {
        issues.push(iss(
          `dr_ci_not_occupied_${bId.slice(0, 8)}`, "high", "daily_rental",
          `Checked-in but unit status mismatch ${label}`,
          `Room ${label} has a checked_in booking but unit.status=${unit.status}`,
          "Fix: set unit.status to daily_occupied.",
          "unit", uid, label, [bId], `/units/${uid}`,
          true, uid,
        ));
      } else {
        issues.push(iss(
          `dr_ci_multi_occupied_${uid.slice(0, 8)}`, "high", "daily_rental",
          `Multiple checked-in bookings ${label}`,
          `Room ${label} has ${ciList.length} checked_in bookings and unit.status=${unit.status}`,
          "Manual review required. Cannot auto-fix.",
          "unit", uid, label, ciList.map(b => b.id as string), `/units/${uid}`,
        ));
      }
    }
  }
  for (const u of units) {
    if (u.status !== "daily_occupied") continue;
    const uid = u.id as string;
    if (!checkedInByUnit.has(uid) || checkedInByUnit.get(uid)!.length === 0) {
      issues.push(iss(
        `dr_occupied_no_ci_${uid.slice(0, 8)}`, "high", "daily_rental",
        `Unit marked occupied but no booking ${u.unit_no ?? uid.slice(0, 8)}`,
        `Room ${u.unit_no ?? uid} unit.status=daily_occupied but no checked_in booking`,
        "Manual review required.",
        "unit", uid, u.unit_no as string ?? uid, [], `/units/${uid}`,
      ));
    }
  }

  // ═══════════════════════════════════════════════════
  // 3. cleaning_task vs unit.status
  // ═══════════════════════════════════════════════════
  const openCleaningByUnit = new Map<string, RawRow[]>();
  for (const ct of cleaningTasks) {
    if (ct.is_completed) continue;
    const uid = ct.unit_id as string;
    if (!openCleaningByUnit.has(uid)) openCleaningByUnit.set(uid, []);
    openCleaningByUnit.get(uid)!.push(ct);
  }
  for (const [uid, tasks] of openCleaningByUnit) {
    const unit = unitById.get(uid);
    if (!unit) continue;
    const label = `${unit.unit_no ?? uid.slice(0, 8)}`;
    if (unit.status !== "cleaning_pending") {
      const hasFutureBooking = bookings.some(b =>
        b.unit_id === uid && (b.status === "confirmed" || b.status === "pending_review") &&
        (b.check_in as string) >= today
      );
      if (!hasFutureBooking) {
        issues.push(iss(
          `dr_clean_not_status_${uid.slice(0, 8)}`, "medium", "daily_rental",
          `Open cleaning but wrong unit status ${label}`,
          `Room ${label} has ${tasks.length} open cleaning tasks but unit.status=${unit.status}`,
          "Fix: set unit.status to cleaning_pending.",
          "unit", uid, label, tasks.map(t => t.id as string), `/units/${uid}`,
          true, uid,
        ));
      }
    }
  }
  for (const u of units) {
    if (u.status !== "cleaning_pending") continue;
    const uid = u.id as string;
    if (!openCleaningByUnit.has(uid) || openCleaningByUnit.get(uid)!.length === 0) {
      issues.push(iss(
        `dr_clean_status_no_task_${uid.slice(0, 8)}`, "medium", "daily_rental",
        `Unit marked cleaning but no task ${u.unit_no ?? uid.slice(0, 8)}`,
        `Room ${u.unit_no ?? uid} unit.status=cleaning_pending but no open cleaning task`,
        "Fix: set unit.status to available.",
        "unit", uid, u.unit_no as string ?? uid, [], `/units/${uid}`,
        true, uid,
      ));
    }
  }

  // ═══════════════════════════════════════════════════
  // 4. Financial inconsistencies
  // ═══════════════════════════════════════════════════

  // 4a. prepaid vs payments
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    const bId = b.id as string;
    const bPayments = payments.filter(p => (p.source_id as string) === bId && (p.source_type as string) === "daily_booking");
    const paymentSum = bPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const bookingPrepaid = Number(b.prepaid_amount_xof) || 0;
    if (Math.abs(bookingPrepaid - paymentSum) > 1) {
      const unit = unitById.get(b.unit_id as string);
      const label = unit ? `${unit.unit_no ?? "?"}` : "?";
      issues.push(iss(
        `dr_fin_prepaid_${bId.slice(0, 8)}`, "high", "finance",
        `Prepaid mismatch ${label}`,
        `Booking ${bId.slice(0, 8)} prepaid=${bookingPrepaid}, payment sum=${paymentSum}`,
        "Fix: run syncBookingFinance.",
        "daily_booking", bId, label, [bId], `/daily-rentals`,
        true, bId,
      ));
    }
  }

  // 4a-2. booking final amount vs booking total amount
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    const bId = b.id as string;
    const expected = expectedDailyAmount(b);
    const storedFinal = Number(b.final_amount_xof ?? b.total_amount_xof) || 0;
    if (Math.abs(storedFinal - expected.final) > 1) {
      const unit = unitById.get(b.unit_id as string);
      const label = unit ? `${unit.unit_no ?? "?"}` : "?";
      issues.push(iss(
        `dr_fin_amount_${bId.slice(0, 8)}`, "high", "finance",
        `订单最终应收不同步 ${label}`,
        `房间 ${label} 订单总额 ${expected.gross}，折扣 ${expected.discount}，最终应收应为 ${expected.final}，订单记录为 ${storedFinal}`,
        "修复：按订单总额和折扣重新同步最终应收与应收账款。",
        "daily_booking", bId, label, [bId], `/daily-rentals`,
        true, bId,
      ));
    }
  }

  // 4b. receivable.paid vs payments
  const paymentsBySource = new Map<string, RawRow[]>();
  for (const p of payments) {
    const sid = p.source_id as string;
    if (!paymentsBySource.has(sid)) paymentsBySource.set(sid, []);
    paymentsBySource.get(sid)!.push(p);
  }
  for (const r of receivables) {
    const rId = r.id as string;
    if ((r.source_type as string) !== "daily_booking") continue;
    const srcId = r.source_id as string;
    const srcPayments = paymentsBySource.get(srcId) ?? [];
    const paymentSum = srcPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const recPaid = Number(r.paid_amount_xof) || 0;
    if (Math.abs(recPaid - paymentSum) > 1) {
      const unit = unitById.get(r.unit_id as string);
      const label = unit ? `${unit.unit_no ?? "?"}` : "?";
      issues.push(iss(
        `dr_fin_rec_paid_${rId.slice(0, 8)}`, "high", "finance",
        `Receivable paid mismatch ${label}`,
        `Receivable ${rId.slice(0, 8)} paid=${recPaid}, payment sum=${paymentSum}`,
        "Fix: run syncBookingFinance.",
        "receivable", rId, label, [srcId], "/finance",
        true, srcId,
      ));
    }
  }

  // 4c. receivable.amount vs booking.final
  const bookingById = new Map<string, RawRow>();
  for (const b of bookings) bookingById.set(b.id as string, b);
  for (const r of receivables) {
    if ((r.source_type as string) !== "daily_booking") continue;
    const srcId = r.source_id as string;
    const booking = bookingById.get(srcId);
    if (!booking) continue;
    const recAmount = Number(r.amount_xof) || 0;
    const bkFinal = Number(booking.final_amount_xof ?? booking.total_amount_xof) || 0;
    if (Math.abs(recAmount - bkFinal) > 1) {
      const unit = unitById.get(booking.unit_id as string);
      const label = unit ? `${unit.unit_no ?? "?"}` : "?";
      issues.push(iss(
        `dr_fin_rec_amt_${String(r.id).slice(0, 40)}`, "high", "finance",
        `Receivable amount mismatch ${label}`,
        `Receivable amount=${recAmount}, booking.final=${bkFinal}`,
        "Fix: run syncBookingFinance.",
        "receivable", r.id as string, label, [srcId], "/finance",
        true, srcId,
      ));
    }
  }

  // 4d. billing_status
  for (const b of bookings) {
    const bId = b.id as string;
    const paid = Number(b.prepaid_amount_xof) || 0;
    const final = Number(b.final_amount_xof ?? b.total_amount_xof) || 0;
    const status = b.status as string;
    let expected: string;
    if (paid >= final) {
      expected = status === "checked_out" ? "settled" : "prepaid";
    } else {
      expected = paid > 0 ? "partially_paid" : "need_top_up";
    }
    if ((b.billing_status as string) !== expected) {
      const unit = unitById.get(b.unit_id as string);
      const label = unit ? `${unit.unit_no ?? "?"}` : "?";
      issues.push(iss(
        `dr_fin_billing_${bId.slice(0, 8)}`, "medium", "finance",
        `Billing status mismatch ${label}`,
        `Billing=${b.billing_status}, expected=${expected}`,
        "Fix: run syncBookingFinance.",
        "daily_booking", bId, label, [bId], `/daily-rentals`,
        true, bId,
      ));
    }
  }

  // 4e. Payment without ledger
  for (const p of payments) {
    if ((p.source_type as string) !== "daily_booking") continue;
    const pId = p.id as string;
    const hasLedger = ledgerEntries.some(e => (e.payment_id as string) === pId);
    if (!hasLedger) {
      const unit = unitById.get(p.unit_id as string);
      const label = unit ? `${unit.unit_no ?? "?"}` : "?";
      issues.push(iss(
        `dr_fin_no_ledger_${pId.slice(0, 8)}`, "high", "finance",
        `Payment missing ledger ${label}`,
        `Payment ${pId.slice(0, 8)} amount ${p.amount} has no ledger entry`,
        "Manual review required. Cannot auto-fix.",
        "payment", pId, label, [p.source_id as string], "/finance",
      ));
    }
  }

  // 4f. Orphan ledger entries
  const paymentIds = new Set(payments.map(p => p.id as string));
  for (const e of ledgerEntries) {
    const ePid = e.payment_id as string | null;
    if (!ePid) continue;
    if (!paymentIds.has(ePid)) {
      issues.push(iss(
        `dr_fin_orphan_ledger_${String(e.id).slice(0, 40)}`, "medium", "finance",
        `Orphan ledger entry`,
        `Ledger entry references deleted payment ${ePid.slice(0, 8)}`,
        "Manual review required. Cannot auto-fix.",
        "ledger_entry", e.id as string, ePid.slice(0, 8), [], "/finance",
      ));
    }
  }

  // ═══════════════════════════════════════════════════
  // 5. Backfill anomalies
  // ═══════════════════════════════════════════════════
  for (const b of bookings) {
    const bId = b.id as string;
    const notes = (b.notes as string) ?? "";
    if (!notes.startsWith("[历史补录]")) continue;
    const unit = unitById.get(b.unit_id as string);
    const label = unit ? `${unit.unit_no ?? "?"}` : "?";

    // 5a. Future date
    if ((b.check_out as string) >= today) {
      issues.push(iss(
        `dr_bf_future_${bId.slice(0, 8)}`, "medium", "daily_rental",
        `Backfill future date ${label}`,
        `Backfill booking ${bId.slice(0, 8)} check_out=${b.check_out} should be past`,
        "Manual review required.",
        "daily_booking", bId, label, [bId], `/daily-rentals`,
      ));
    }

    // 5b. Missing audit log
    const hasAudit = auditLogs.some(
      l => (l.entity_id as string) === bId && (l.action as string) === "daily_booking_backfill"
    );
    if (!hasAudit) {
      issues.push(iss(
        `dr_bf_no_audit_${bId.slice(0, 8)}`, "low", "daily_rental",
        `Backfill missing audit ${label}`,
        `Backfill booking ${bId.slice(0, 8)} missing audit log`,
        "Fix: insert audit log.",
        "daily_booking", bId, label, [bId], `/daily-rentals`,
        true, bId,
      ));
    }

    // 5c. Unit status affected
    if (unit && (unit.status as string) === "reserved") {
      issues.push(iss(
        `dr_bf_unit_status_${bId.slice(0, 8)}`, "medium", "daily_rental",
        `Backfill affects unit status ${label}`,
        `Backfill booking ${bId.slice(0, 8)} unit.status=reserved`,
        "Fix: correct unit.status.",
        "unit", unit.id as string, label, [bId], `/units/${unit.id}`,
        true, unit.id as string,
      ));
    }
  }

  return issues;
}

export type { RepairResult } from "./daily-rental-repair";
