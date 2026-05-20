import type {
  UnitRow, CustomerRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, ReceivableRow, PaymentRow,
} from "@/types/database";
import type { QualityIssue, QualityCategory, QualitySeverity, TodoRole } from "./quality-types";
import { CATEGORY_ROLES } from "./quality-types";

const today = new Date().toISOString().slice(0, 10);

export interface DataSnapshot {
  units: UnitRow[];
  customers: CustomerRow[];
  dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  saleSchedules: SalePaymentScheduleRow[];
  receivables: ReceivableRow[];
  payments: PaymentRow[];
}

function issue(
  id: string, sev: QualitySeverity, cat: QualityCategory,
  title: string, description: string, suggestedAction: string,
  entityType: string, entityId: string | null, entityLabel: string,
  related: string[] = [], href = "",
): QualityIssue {
  return { id, severity: sev, category: cat, title, description, entityType, entityId: entityId ?? null, entityLabel, relatedEntities: related, href, suggestedAction, detectedAt: today, status: "open" };
}

/** Run all rules and return issues. Filter by role if non-null. */
export function runQualityChecks(data: DataSnapshot, role?: TodoRole): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // ── Unit status vs business reality ──
  for (const unit of data.units) {
    const label = `${unit.unit_no} (${unit.kind})`;

    // Missing key fields
    if (!unit.building_id) issues.push(issue(
      `unit_missing_bldg_${unit.id}`, "high", "unit",
      `房源缺少楼栋 ${unit.unit_no}`, `房源 ${unit.unit_no} (${unit.id.slice(0, 8)}) 缺少 building_id`, "补充楼栋关联",
      "unit", unit.id, label, [], "/units",
    ));
    if (!unit.floor_label) issues.push(issue(
      `unit_missing_floor_${unit.id}`, "medium", "unit",
      `房源缺少楼层 ${unit.unit_no}`, `房源 ${unit.unit_no} 缺少 floor_label`, "补充楼层信息",
      "unit", unit.id, label, [], "/units",
    ));

    // Unit shows "available" but has active lease
    if (unit.status === "available") {
      const activeLease = data.leaseContracts.find(l => l.unit_id === unit.id && l.status === "active");
      if (activeLease) issues.push(issue(
        `unit_avail_leased_${unit.id}`, "high", "unit",
        `房态异常 ${unit.unit_no}: 显示空闲但有生效长租`,
        `${unit.unit_no} 房态为 available，但存在生效长租合同 ${activeLease.contract_no}`,
        "检查合同状态或手动修正房态为 leased",
        "unit", unit.id, label, [activeLease.id], "/leases",
      ));

      const activeDaily = data.dailyBookings.find(b => b.unit_id === unit.id && b.status === "checked_in");
      if (activeDaily) issues.push(issue(
        `unit_avail_daily_${unit.id}`, "high", "unit",
        `房态异常 ${unit.unit_no}: 显示空闲但有日租入住`,
        `${unit.unit_no} 房态为 available，但存在 checked_in 日租 ${activeDaily.check_in}`,
        "检查日租状态或手动修正房态为 daily_occupied",
        "unit", unit.id, label, [activeDaily.id], "/daily-rentals",
      ));
    }

    // Unit shows "sold" but has active lease/daily
    if (unit.status === "sold") {
      const activeLease = data.leaseContracts.find(l => l.unit_id === unit.id && l.status === "active");
      if (activeLease) issues.push(issue(
        `unit_sold_leased_${unit.id}`, "high", "unit",
        `已售房源存在长租 ${unit.unit_no}`,
        `${unit.unit_no} 房态为 sold，但存在生效长租合同 ${activeLease.contract_no}`,
        "确认出售/长租冲突，修正一方状态",
        "unit", unit.id, label, [activeLease.id], "/leases",
      ));
    }

    // Both active lease AND active daily on same unit
    const hasLease = data.leaseContracts.some(l => l.unit_id === unit.id && l.status === "active");
    const hasDaily = data.dailyBookings.some(b => b.unit_id === unit.id && b.status === "checked_in");
    if (hasLease && hasDaily) issues.push(issue(
      `unit_conflict_${unit.id}`, "high", "unit",
      `房源冲突 ${unit.unit_no}: 同时存在长租和日租占用`,
      `${unit.unit_no} 同时存在生效长租和 checked_in 日租`,
      "确认实际占用方式，取消冲突一方",
      "unit", unit.id, label, [], "/units",
    ));

    // checked_in daily but unit status != daily_occupied
    if (hasDaily && unit.status !== "daily_occupied") {
      issues.push(issue(
        `unit_status_mismatch_daily_${unit.id}`, "medium", "daily_rental",
        `日租房态不匹配 ${unit.unit_no}`,
        `${unit.unit_no} checked_in 但房态为 ${unit.status} 而非 daily_occupied`,
        "手动修正房态为 daily_occupied",
        "unit", unit.id, label, [], "/units",
      ));
    }

    // sold status but no active sale contract
    if (unit.status === "sold") {
      const activeSale = data.saleContracts.find(s => s.unit_id === unit.id && s.status === "active");
      if (!activeSale) {
        const anySale = data.saleContracts.find(s => s.unit_id === unit.id);
        if (!anySale) issues.push(issue(
          `unit_sold_no_contract_${unit.id}`, "medium", "unit",
          `已售房源缺少合同 ${unit.unit_no}`,
          `${unit.unit_no} 房态为 sold 但无出售合同记录`,
          "核实房源状态或创建出售合同",
          "unit", unit.id, label, [], "/units",
        ));
      }
    }

    // parking/storefront in apartment matrix
    if ((unit.kind === "parking" || unit.kind === "storefront" || unit.kind === "office") && unit.status === "daily_occupied") {
      issues.push(issue(
        `unit_nontypical_${unit.id}`, "low", "unit",
        `非住宿单元日租占用 ${unit.unit_no}`,
        `${unit.unit_no} (${unit.kind}) 显示为日租占用，非公寓类型`,
        "确认是否需要日租该单元",
        "unit", unit.id, label, [], "/units",
      ));
    }
  }

  // ── Customers: duplicates ──
  const custByPhone = new Map<string, CustomerRow[]>();
  const custByName = new Map<string, CustomerRow[]>();
  for (const c of data.customers) {
    if (c.phone) {
      const list = custByPhone.get(c.phone) ?? [];
      list.push(c);
      custByPhone.set(c.phone, list);
    }
    const list = custByName.get(c.name) ?? [];
    list.push(c);
    custByName.set(c.name, list);
  }

  for (const [phone, list] of custByPhone) {
    if (list.length < 2) continue;
    for (let i = 1; i < list.length; i++) {
      issues.push(issue(
        `cust_dup_phone_${list[0].id}_${list[i].id}`, "high", "customer",
        `重复客户（同手机号）`,
        `手机号 ${phone} 关联多个客户: ${list.map(c => c.name).join(", ")}`,
        "合并客户记录",
        "customer", list[0].id, list[0].name,
        list.slice(1).map(c => c.id), "/customers",
      ));
    }
  }

  for (const [, list] of custByName) {
    if (list.length < 2) continue;
    const noPhones = list.every(c => !c.phone);
    if (!noPhones) continue; // only flag if ALL have no phone (ambiguous)
    for (let i = 1; i < list.length; i++) {
      issues.push(issue(
        `cust_dup_name_${list[0].id}_${list[i].id}`, "medium", "customer",
        `疑似重复客户（同名无手机）`,
        `姓名 "${list[0].name}" 出现 ${list.length} 次，均无手机号`,
        "核实是否为同一客户后合并",
        "customer", list[0].id, list[0].name,
        list.slice(1).map(c => c.id), "/customers",
      ));
    }
  }

  // ── Customer: in active contract but missing phone ──
  for (const c of data.customers) {
    if (c.phone) continue;
    const inLease = data.leaseContracts.some(l => l.customer_id === c.id && l.status === "active");
    const inSale = data.saleContracts.some(s => s.customer_id === c.id && s.status === "active");
    const inDaily = data.dailyBookings.some(b => b.customer_id === c.id && (b.status === "checked_in" || b.status === "confirmed"));
    if (inLease || inSale || inDaily) {
      issues.push(issue(
        `cust_no_phone_active_${c.id}`, "medium", "customer",
        `活跃客户缺少手机号 ${c.name}`,
        `客户 ${c.name} 有生效合同/预订但无手机号`,
        "补充客户手机号",
        "customer", c.id, c.name, [], "/customers",
      ));
    }
  }

  // ── Daily bookings: conflicts ──
  const dailyByUnit = new Map<string, DailyBookingRow[]>();
  for (const b of data.dailyBookings) {
    if (b.status === "cancelled" || b.status === "checked_out") continue;
    const list = dailyByUnit.get(b.unit_id) ?? [];
    list.push(b);
    dailyByUnit.set(b.unit_id, list);
  }
  for (const [, list] of dailyByUnit) {
    if (list.length < 2) continue;
    const names = list.map(b => `${b.check_in} (${b.status})`).join(", ");
    issues.push(issue(
      `daily_dup_${list[0].unit_id}_${list[0].id}`, "high", "daily_rental",
      `同一房间多笔活跃预订`,
      `房间存在 ${list.length} 笔未取消/不退房的预订: ${names}`,
      "取消冲突预订或确认实际占用",
      "daily_booking", list[0].id, list[0].unit_id,
      list.slice(1).map(b => b.id), "/daily-rentals",
    ));
  }

  // Daily: pending_review past check_in date
  for (const b of data.dailyBookings) {
    if (b.status !== "pending_review") continue;
    if (b.check_in >= today) continue;
    issues.push(issue(
      `daily_stale_pending_${b.id}`, "medium", "daily_rental",
      `待审核预订已过期 ${b.check_in}`,
      `预订 ${b.check_in} 状态仍为 pending_review，已过入住日`,
      "确认或取消该预订",
      "daily_booking", b.id, b.check_in, [], "/daily-rentals",
    ));
  }

  // Daily: checked_in but unit not daily_occupied
  for (const b of data.dailyBookings) {
    if (b.status !== "checked_in") continue;
    const unit = data.units.find(u => u.id === b.unit_id);
    if (unit && unit.status !== "daily_occupied") {
      issues.push(issue(
        `daily_status_mismatch_${b.id}`, "medium", "daily_rental",
        `日租房态不匹配 ${unit.unit_no}`,
        `${unit.unit_no} checked_in 但房态为 ${unit.status}`,
        "修正房态为 daily_occupied",
        "daily_booking", b.id, unit.unit_no, [unit.id], "/daily-rentals",
      ));
    }
  }

  // ── Lease: missing fields ──
  for (const lc of data.leaseContracts) {
    if (lc.status !== "active" && lc.status !== "draft") continue;
    const unit = data.units.find(u => u.id === lc.unit_id);
    const label = lc.contract_no;
    if (!lc.start_date) issues.push(issue(
      `lease_missing_start_${lc.id}`, "high", "lease",
      `合同缺少起租日期 ${lc.contract_no}`, `合同 ${lc.contract_no} 缺少 start_date`, "补充起租日期",
      "lease_contract", lc.id, label, [], "/leases",
    ));
    if (!lc.expected_end_date) issues.push(issue(
      `lease_missing_end_${lc.id}`, "high", "lease",
      `合同缺少到期日期 ${lc.contract_no}`, `合同 ${lc.contract_no} 缺少 expected_end_date`, "补充到期日期",
      "lease_contract", lc.id, label, [], "/leases",
    ));
    if (!Number(lc.monthly_rent_xof) || Number(lc.monthly_rent_xof) <= 0) issues.push(issue(
      `lease_missing_rent_${lc.id}`, "high", "lease",
      `合同缺少月租金 ${lc.contract_no}`, `合同 ${lc.contract_no} 月租为空或≤0`, "补充月租金",
      "lease_contract", lc.id, label, [], "/leases",
    ));
    if (!lc.customer_id) issues.push(issue(
      `lease_missing_cust_${lc.id}`, "high", "lease",
      `合同缺少客户 ${lc.contract_no}`, `合同 ${lc.contract_no} 缺少 customer_id`, "补充客户关联",
      "lease_contract", lc.id, label, [], "/leases",
    ));
    if (!lc.unit_id) issues.push(issue(
      `lease_missing_unit_${lc.id}`, "high", "lease",
      `合同缺少房源 ${lc.contract_no}`, `合同 ${lc.contract_no} 缺少 unit_id`, "补充房源关联",
      "lease_contract", lc.id, label, [], "/leases",
    ));

    // Active lease but unit is available or other non-leased status
    if (lc.status === "active" && unit && unit.status !== "leased") {
      issues.push(issue(
        `lease_unit_status_${lc.id}`, "high", "lease",
        `长租房态不匹配 ${lc.contract_no}`,
        `合同生效中但房源 ${unit.unit_no} 房态为 ${unit.status} 而非 leased`,
        "修正房态为 leased",
        "lease_contract", lc.id, label, [unit.id], "/leases",
      ));
    }

    // Expired but still active
    if (lc.status === "active" && lc.expected_end_date < today) {
      issues.push(issue(
        `lease_expired_active_${lc.id}`, "high", "lease",
        `合同已到期仍活跃 ${lc.contract_no}`,
        `合同 ${lc.contract_no} 到期 ${lc.expected_end_date}，状态仍为 active`,
        "执行退租结算或将状态改为 expired/terminated",
        "lease_contract", lc.id, label, [], "/leases",
      ));
    }
  }

  // ── Lease: receivables missing contract/customer ──
  for (const r of data.receivables) {
    if (r.source_type !== "lease_contract") continue;
    if (r.status === "cancelled") continue;
    if (!r.customer_id) issues.push(issue(
      `rec_missing_cust_${r.id}`, "medium", "finance",
      `长租应收缺少客户 ${r.title}`, `${r.title} 缺少 customer_id`, "补充客户关联",
      "receivable", r.id, r.title, [], "/finance",
    ));
    if (!r.unit_id) issues.push(issue(
      `rec_missing_unit_${r.id}`, "medium", "finance",
      `长租应收缺少房源 ${r.title}`, `${r.title} 缺少 unit_id`, "补充房源关联",
      "receivable", r.id, r.title, [], "/finance",
    ));
  }

  // ── Sale: missing fields ──
  for (const sc of data.saleContracts) {
    if (sc.status !== "active" && sc.status !== "draft") continue;
    const label = sc.contract_no;
    if (!sc.customer_id) issues.push(issue(
      `sale_missing_cust_${sc.id}`, "high", "sale", `出售合同缺少客户 ${sc.contract_no}`,
      `合同 ${sc.contract_no} 缺少 customer_id`, "补充客户", "sale_contract", sc.id, label, [], "/sales",
    ));
    if (!sc.unit_id) issues.push(issue(
      `sale_missing_unit_${sc.id}`, "high", "sale", `出售合同缺少房源 ${sc.contract_no}`,
      `合同 ${sc.contract_no} 缺少 unit_id`, "补充房源", "sale_contract", sc.id, label, [], "/sales",
    ));
    if (!Number(sc.total_amount_xof) || Number(sc.total_amount_xof) <= 0) issues.push(issue(
      `sale_missing_amount_${sc.id}`, "high", "sale", `出售合同缺少总价 ${sc.contract_no}`,
      `合同 ${sc.contract_no} 总价为空或≤0`, "补充总价", "sale_contract", sc.id, label, [], "/sales",
    ));
    if (!sc.signed_date) issues.push(issue(
      `sale_missing_date_${sc.id}`, "high", "sale", `出售合同缺少签约日期 ${sc.contract_no}`,
      `合同 ${sc.contract_no} 缺少 signed_date`, "补充签约日期", "sale_contract", sc.id, label, [], "/sales",
    ));

    // Active sale but unit not sold
    const unit = data.units.find(u => u.id === sc.unit_id);
    if (sc.status === "active" && unit && unit.status !== "sold") {
      issues.push(issue(
        `sale_unit_status_${sc.id}`, "high", "sale", `出售房态不匹配 ${sc.contract_no}`,
        `合同生效中但房源 ${unit.unit_no} 房态为 ${unit.status} 而非 sold`, "修正房态为 sold",
        "sale_contract", sc.id, label, [unit.id], "/sales",
      ));
    }

    // Payment schedule total vs contract total
    const schedTotal = data.saleSchedules
      .filter(s => s.sale_contract_id === sc.id)
      .reduce((sum, s) => sum + Number(s.amount_xof), 0);
    if (schedTotal > 0 && Math.abs(schedTotal - Number(sc.total_amount_xof)) > 1) {
      issues.push(issue(
        `sale_sched_mismatch_${sc.id}`, "high", "sale", `出售分期总额不一致 ${sc.contract_no}`,
        `合同总价 ${sc.total_amount_xof}，分期合计 ${schedTotal}，差额 ${Math.abs(schedTotal - Number(sc.total_amount_xof))}`,
        "修正分期计划使合计等于合同总价", "sale_contract", sc.id, label, [], "/sales",
      ));
    }
  }

  // ── Finance: amount anomalies ──
  for (const r of data.receivables) {
    if (r.status === "cancelled") continue;
    const amount = Number(r.amount_xof);
    const paid = Number(r.paid_amount_xof);

    if (amount <= 0) issues.push(issue(
      `rec_negative_${r.id}`, "high", "finance", `应收金额异常 ${r.title}`,
      `${r.title} 金额为 ${amount}`, "检查并修正应收金额", "receivable", r.id, r.title, [], "/finance",
    ));
    if (paid > amount) issues.push(issue(
      `rec_overpaid_${r.id}`, "high", "finance", `实收大于应收 ${r.title}`,
      `${r.title} 应收 ${amount}，已收 ${paid}，超出 ${paid - amount}`, "核实多收原因，退款或调整应收",
      "receivable", r.id, r.title, [], "/finance",
    ));
    if (r.status !== "overdue" && r.due_date < today && paid < amount) {
      issues.push(issue(
        `rec_unmarked_overdue_${r.id}`, "medium", "finance", `逾期未标记 ${r.title}`,
        `${r.title} due ${r.due_date}，未收 ${amount - paid}，但状态为 ${r.status} 而非 overdue`,
        "系统将自动同步逾期状态", "receivable", r.id, r.title, [], "/finance",
      ));
    }
  }

  // ── Payments: missing unit/customer ──
  for (const p of data.payments) {
    if (!p.customer_id && !p.unit_id) {
      issues.push(issue(
        `pay_no_ref_${p.id}`, "medium", "finance", `收款缺少关联 ${p.payment_date}`,
        `收款 ${p.amount} 于 ${p.payment_date} 无客户也无房源关联`, "补充客户或房源关联",
        "payment", p.id, `${p.amount} ${p.payment_date}`, [], "/finance",
      ));
    }
  }

  // ── System: seed account roles ──
  // Only check if user_profiles accessible - gracefully skip if not
  // (This is a soft check since we can't query user_profiles from here)

  // ── Filter by role ──
  if (role) {
    return issues.filter(i => CATEGORY_ROLES[i.category]?.includes(role));
  }

  // Sort: high first, then category
  issues.sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2 };
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
    return a.category.localeCompare(b.category);
  });

  return issues;
}
