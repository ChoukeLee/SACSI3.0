import "server-only";

import { createClient } from "@/lib/supabase/server";
import { financialBusinessLabel, statusDisplayLabel } from "@/lib/display-labels";
import { addIsoDays, isReceivableOverdue, receivableOutstanding } from "@/features/finance/metrics";
import { buildDailyRoomStateMap } from "@/features/daily-rentals/room-status";
import { formatXof, sortUnits } from "@/lib/utils";
import type { BuildingRow, CustomerRow, DailyBookingRow, ReceivableRow, UnitRow } from "@/types/database";
import type { WorkbenchDomain, WorkbenchIntent, WorkbenchResult, WorkbenchTable } from "./types";

type BuildingSummary = Pick<BuildingRow, "id" | "code" | "display_name">;
type UnitSummary = Pick<UnitRow, "id" | "building_id" | "unit_no" | "floor_label" | "status" | "code">;
type CustomerSummary = Pick<CustomerRow, "id" | "name">;

const SOURCE_TYPES: Record<Exclude<WorkbenchDomain, "all">, ReceivableRow["source_type"]> = {
  daily: "daily_booking",
  lease: "lease_contract",
  sale: "sale_contract",
};

function domainLabel(domain: WorkbenchDomain) {
  return { all: "全部业务", daily: "日租", lease: "长租", sale: "出售" }[domain];
}

function buildingLabel(building: BuildingSummary | undefined) {
  return building?.display_name || building?.code || "未归属楼栋";
}

function statusLabel(status: string) {
  const roomStatuses: Record<string, string> = {
    occupied: "占用",
    checking_out_today: "今日离店",
    reserved: "已预订",
    cleaning: "待保洁",
    available: "可安排入住",
    maintenance: "维修",
    locked: "锁定",
  };
  return roomStatuses[status] ?? statusDisplayLabel(status, "zh");
}

function generatedAtText(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function baseEvidence(intent: WorkbenchIntent, generatedAt: string) {
  const sourceLabel = intent.source === "deepseek" ? "DeepSeek 意图分类 + 固定查询" : intent.source === "openai" ? "OpenAI 意图分类 + 固定查询" : "本地规则识别 + 固定查询";
  return [
    { label: "数据范围", value: domainLabel(intent.domain) },
    { label: "统计时点", value: `${intent.asOfDate}（阿比让）` },
    { label: "生成时间", value: `${generatedAtText(generatedAt)}（阿比让）` },
    { label: "取数方式", value: "当前账号权限下的系统实时记录" },
    { label: "问题识别", value: sourceLabel },
  ];
}

function toResult(input: Omit<WorkbenchResult, "kind" | "generatedAt" | "evidence"> & { evidence?: WorkbenchResult["evidence"] }): WorkbenchResult {
  const generatedAt = new Date().toISOString();
  return {
    ...input,
    kind: "query_result",
    generatedAt,
    evidence: [...baseEvidence(input.intent, generatedAt), ...(input.evidence ?? [])],
  };
}

function receivableColumns(): WorkbenchTable["columns"] {
  return [
    { key: "dueDate", label: "到期日" },
    { key: "building", label: "楼栋" },
    { key: "unit", label: "房号" },
    { key: "customer", label: "客户" },
    { key: "business", label: "业务" },
    { key: "title", label: "应收项目" },
    { key: "amount", label: "应收", align: "right" },
    { key: "paid", label: "已收", align: "right" },
    { key: "outstanding", label: "未收", align: "right" },
  ];
}

async function retainLiveBusinessSources(rows: ReceivableRow[]) {
  const supabase = await createClient();
  const grouped = {
    daily: rows.filter((row) => row.source_type === "daily_booking" && row.source_id).map((row) => row.source_id!),
    lease: rows.filter((row) => row.source_type === "lease_contract" && row.source_id).map((row) => row.source_id!),
    sale: rows.filter((row) => row.source_type === "sale_contract" && row.source_id).map((row) => row.source_id!),
  };

  const [dailyRes, leaseRes, saleRes] = await Promise.all([
    grouped.daily.length
      ? supabase.from("daily_bookings").select("id, status").in("id", [...new Set(grouped.daily)])
      : Promise.resolve({ data: [], error: null }),
    grouped.lease.length
      ? supabase.from("lease_contracts").select("id, status").in("id", [...new Set(grouped.lease)])
      : Promise.resolve({ data: [], error: null }),
    grouped.sale.length
      ? supabase.from("sale_contracts").select("id, status").in("id", [...new Set(grouped.sale)])
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (dailyRes.error) throw new Error(`读取日租订单状态失败：${dailyRes.error.message}`);
  if (leaseRes.error) throw new Error(`读取长租合同状态失败：${leaseRes.error.message}`);
  if (saleRes.error) throw new Error(`读取出售合同状态失败：${saleRes.error.message}`);

  const liveDaily = new Set((dailyRes.data ?? []).filter((row) => row.status !== "cancelled").map((row) => row.id));
  const liveLease = new Set((leaseRes.data ?? []).filter((row) => row.status === "active").map((row) => row.id));
  const liveSale = new Set((saleRes.data ?? []).filter((row) => row.status === "active").map((row) => row.id));

  return rows.filter((row) => {
    if (!row.source_id) return false;
    if (row.source_type === "daily_booking") return liveDaily.has(row.source_id);
    if (row.source_type === "lease_contract") return liveLease.has(row.source_id);
    if (row.source_type === "sale_contract") return liveSale.has(row.source_id);
    return false;
  });
}

async function queryReceivables(query: string, intent: WorkbenchIntent): Promise<WorkbenchResult> {
  const supabase = await createClient();
  const sourceTypes = intent.domain === "all"
    ? Object.values(SOURCE_TYPES)
    : [SOURCE_TYPES[intent.domain]];
  const endDate = addIsoDays(intent.asOfDate, intent.days);

  let dbQuery = supabase
    .from("receivables")
    .select("id, building_id, unit_id, customer_id, source_type, source_id, category, title, due_date, amount_xof, paid_amount_xof, status, management_status, currency, notes, created_at, updated_at")
    .in("source_type", sourceTypes)
    .eq("management_status", "managed")
    .neq("status", "cancelled")
    .order("due_date", { ascending: true })
    .limit(2000);

  if (intent.kind === "receivable_overdue") dbQuery = dbQuery.lt("due_date", intent.asOfDate);
  if (intent.kind === "receivable_due_soon") dbQuery = dbQuery.gt("due_date", intent.asOfDate).lte("due_date", endDate);

  const { data, error } = await dbQuery;
  if (error) throw new Error(`读取应收记录失败：${error.message}`);

  let rows = ((data ?? []) as unknown as ReceivableRow[]).filter((row) => receivableOutstanding(row) > 0);
  if (intent.kind === "receivable_overdue") rows = rows.filter((row) => isReceivableOverdue(row, intent.asOfDate));
  rows = await retainLiveBusinessSources(rows);

  const unitIds = [...new Set(rows.map((row) => row.unit_id).filter((id): id is string => Boolean(id)))];
  const customerIds = [...new Set(rows.map((row) => row.customer_id).filter((id): id is string => Boolean(id)))];
  const [unitsRes, customersRes, buildingsRes] = await Promise.all([
    unitIds.length ? supabase.from("units").select("id, building_id, unit_no, floor_label, status, code").in("id", unitIds) : Promise.resolve({ data: [], error: null }),
    customerIds.length ? supabase.from("customers").select("id, name").in("id", customerIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("buildings").select("id, code, display_name").eq("is_active", true),
  ]);
  if (unitsRes.error) throw new Error(`读取房源失败：${unitsRes.error.message}`);
  if (customersRes.error) throw new Error(`读取客户失败：${customersRes.error.message}`);
  if (buildingsRes.error) throw new Error(`读取楼栋失败：${buildingsRes.error.message}`);

  const units = new Map(((unitsRes.data ?? []) as unknown as UnitSummary[]).map((row) => [row.id, row]));
  const customers = new Map(((customersRes.data ?? []) as unknown as CustomerSummary[]).map((row) => [row.id, row.name]));
  const buildings = new Map(((buildingsRes.data ?? []) as unknown as BuildingSummary[]).map((row) => [row.id, row]));

  if (intent.buildingCode) {
    const building = [...buildings.values()].find((row) => row.code.toUpperCase() === intent.buildingCode);
    rows = building ? rows.filter((row) => row.building_id === building.id || units.get(row.unit_id ?? "")?.building_id === building.id) : [];
  }
  if (intent.unitNo) rows = rows.filter((row) => units.get(row.unit_id ?? "")?.unit_no.toUpperCase() === intent.unitNo);

  const total = rows.reduce((sum, row) => sum + receivableOutstanding(row), 0);
  const rowData = rows.map((row) => {
    const unit = units.get(row.unit_id ?? "");
    const building = buildings.get(row.building_id ?? unit?.building_id ?? "");
    return {
      dueDate: row.due_date,
      building: buildingLabel(building),
      unit: unit?.unit_no ?? "—",
      customer: customers.get(row.customer_id ?? "") ?? "—",
      business: financialBusinessLabel(row.source_type, "zh", row.category),
      title: row.title,
      amount: formatXof(row.amount_xof),
      paid: formatXof(row.paid_amount_xof),
      outstanding: formatXof(receivableOutstanding(row)),
    };
  });
  const kindLabel = intent.kind === "receivable_overdue" ? "逾期" : intent.kind === "receivable_due_soon" ? `${intent.days} 天内应缴` : "当前未收";
  const scope = `${domainLabel(intent.domain)} · ${intent.buildingCode ? intent.buildingCode.replace("SACSI", "") + "#" : "全部在管楼栋"}`;

  return toResult({
    query,
    intent,
    title: `${kindLabel}明细`,
    answer: rows.length ? `${scope}共有 ${rows.length} 笔${kindLabel}，未收合计 ${formatXof(total)}。` : `${scope}没有符合口径的${kindLabel}记录。`,
    scope,
    metrics: [
      { label: "笔数", value: String(rows.length), tone: rows.length ? "amber" : "green" },
      { label: "未收合计", value: formatXof(total), tone: intent.kind === "receivable_overdue" && total > 0 ? "red" : total > 0 ? "amber" : "green" },
      ...(intent.kind === "receivable_due_soon" ? [{ label: "截止日期", value: endDate, tone: "blue" as const }] : []),
    ],
    table: { columns: receivableColumns(), rows: rowData.slice(0, 100) },
    evidence: [
      { label: "财务口径", value: "仅统计已确认管理（managed）、未取消且未收余额大于 0 的应收" },
      { label: "合同口径", value: "长租和出售仅保留生效合同；日租排除已取消订单" },
      { label: "逾期定义", value: "到期日早于统计日；到期当天不算逾期" },
    ],
    warnings: rows.length > 100 ? [`共 ${rows.length} 笔，表格仅展示前 100 笔。`] : [],
    resultCount: rows.length,
  });
}

async function queryDailyStatus(query: string, intent: WorkbenchIntent): Promise<WorkbenchResult> {
  const supabase = await createClient();
  let buildingQuery = supabase.from("buildings").select("id, code, display_name").eq("is_active", true);
  if (intent.buildingCode) buildingQuery = buildingQuery.eq("code", intent.buildingCode);
  const { data: buildingData, error: buildingError } = await buildingQuery;
  if (buildingError) throw new Error(`读取楼栋失败：${buildingError.message}`);
  const buildings = (buildingData ?? []) as unknown as BuildingSummary[];
  const buildingIds = buildings.map((row) => row.id);
  if (!buildingIds.length) {
    return toResult({ query, intent, title: "日租房态", answer: "没有找到指定的在管楼栋。", scope: intent.buildingCode ?? "全部楼栋", metrics: [], table: null, warnings: ["请检查楼栋编号。"], resultCount: 0 });
  }

  const [unitsRes, bookingsRes, cleaningRes] = await Promise.all([
    supabase.from("units")
      .select("id, building_id, code, unit_no, floor_label, status, unit_business_flags!inner(business_type, is_enabled)")
      .in("building_id", buildingIds)
      .eq("unit_business_flags.business_type", "daily_rental")
      .eq("unit_business_flags.is_enabled", true)
      .in("status", ["available", "reserved", "daily_occupied", "cleaning_pending", "maintenance", "locked"])
      .order("unit_no"),
    supabase.from("daily_bookings")
      .select("id, unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, nightly_price_xof, total_amount_xof, prepaid_amount_xof, billing_status, manual_discount_amount_xof, final_amount_xof, status, notes, created_at, updated_at")
      .in("status", ["pending_review", "confirmed", "checked_in"])
      .lte("check_in", intent.asOfDate)
      .order("check_in", { ascending: false })
      .limit(500),
    supabase.from("cleaning_tasks").select("id, unit_id, daily_booking_id, is_completed").eq("is_completed", false),
  ]);
  if (unitsRes.error) throw new Error(`读取日租房源失败：${unitsRes.error.message}`);
  if (bookingsRes.error) throw new Error(`读取日租订单失败：${bookingsRes.error.message}`);
  if (cleaningRes.error) throw new Error(`读取保洁状态失败：${cleaningRes.error.message}`);

  const units = sortUnits((unitsRes.data ?? []) as unknown as UnitRow[]);
  const unitIds = new Set(units.map((row) => row.id));
  const bookings = ((bookingsRes.data ?? []) as unknown as DailyBookingRow[]).filter((row) => unitIds.has(row.unit_id));
  const customerIds = [...new Set(bookings.map((row) => row.customer_id).filter(Boolean))];
  const customersRes = customerIds.length ? await supabase.from("customers").select("id, name").in("id", customerIds) : { data: [], error: null };
  if (customersRes.error) throw new Error(`读取客户失败：${customersRes.error.message}`);

  const customerNames = new Map(((customersRes.data ?? []) as CustomerSummary[]).map((row) => [row.id, row.name]));
  const buildingMap = new Map(buildings.map((row) => [row.id, row]));
  const states = buildDailyRoomStateMap({
    dailyUnits: units,
    dateStr: intent.asOfDate,
    bookings,
    cleaningTasks: cleaningRes.data ?? [],
  });
  const counts = { occupied: 0, checking_out_today: 0, reserved: 0, cleaning: 0, available: 0, maintenance: 0, locked: 0 };
  const rows = units.map((unit) => {
    const state = states.get(unit.id)!;
    counts[state.status] += 1;
    const booking = state.booking;
    return {
      building: buildingLabel(buildingMap.get(unit.building_id)),
      unit: unit.unit_no,
      status: statusLabel(state.status),
      guest: customerNames.get(booking?.customer_id ?? "") || "—",
      period: booking ? `${booking.check_in} 至 ${booking.checkout_mode === "open" && !booking.actual_check_out ? "未定" : booking.actual_check_out ?? booking.check_out ?? "未定"}` : "—",
    };
  });
  const scope = `日租 · ${intent.buildingCode ? intent.buildingCode.replace("SACSI", "") + "#" : buildings.map((row) => row.code.replace("SACSI", "") + "#").join("、")}`;

  return toResult({
    query,
    intent,
    title: `${intent.asOfDate} 日租房态`,
    answer: `${scope}共 ${units.length} 间：占用 ${counts.occupied + counts.checking_out_today} 间，预订 ${counts.reserved} 间，待保洁 ${counts.cleaning} 间，可安排入住 ${counts.available} 间。`,
    scope,
    metrics: [
      { label: "占用", value: String(counts.occupied + counts.checking_out_today), tone: "blue" },
      { label: "今日离店", value: String(counts.checking_out_today), tone: "amber" },
      { label: "待保洁", value: String(counts.cleaning), tone: "teal" },
      { label: "可安排入住", value: String(counts.available), tone: "green" },
    ],
    table: {
      columns: [
        { key: "building", label: "楼栋" }, { key: "unit", label: "房号" }, { key: "status", label: "房态" },
        { key: "guest", label: "登记联系人" }, { key: "period", label: "入住区间" },
      ],
      rows,
    },
    evidence: [
      { label: "房态口径", value: "日租启用房源；在住优先，其次待保洁、预订、维修/锁定、可安排入住" },
      { label: "订单口径", value: "排除已取消订单；开放式入住在未办理离店前持续占用" },
    ],
    warnings: [],
    resultCount: units.length,
  });
}

async function queryUnitSnapshot(query: string, intent: WorkbenchIntent): Promise<WorkbenchResult> {
  const supabase = await createClient();
  const [buildingsRes, unitsRes] = await Promise.all([
    supabase.from("buildings").select("id, code, display_name").eq("is_active", true),
    supabase.from("units").select("id, building_id, unit_no, floor_label, status, code").eq("unit_no", intent.unitNo!),
  ]);
  if (buildingsRes.error) throw new Error(`读取楼栋失败：${buildingsRes.error.message}`);
  if (unitsRes.error) throw new Error(`读取房源失败：${unitsRes.error.message}`);
  const buildings = (buildingsRes.data ?? []) as unknown as BuildingSummary[];
  const buildingMap = new Map(buildings.map((row) => [row.id, row]));
  let matches = (unitsRes.data ?? []) as unknown as UnitSummary[];
  if (intent.buildingCode) matches = matches.filter((row) => buildingMap.get(row.building_id)?.code.toUpperCase() === intent.buildingCode);

  if (matches.length !== 1) {
    const message = matches.length === 0 ? "没有找到对应房源。" : "该房号存在于多个楼栋，请在问题中补充楼栋编号。";
    return toResult({
      query,
      intent,
      title: "房源定位",
      answer: message,
      scope: intent.unitNo ?? "未识别房号",
      metrics: [],
      table: matches.length ? { columns: [{ key: "building", label: "楼栋" }, { key: "unit", label: "房号" }, { key: "status", label: "当前房态" }], rows: matches.map((row) => ({ building: buildingLabel(buildingMap.get(row.building_id)), unit: row.unit_no, status: statusLabel(row.status) })) } : null,
      warnings: [matches.length ? "例如：查看 11#503 的合同和收款。" : "请检查楼栋和房号。"],
      resultCount: matches.length,
    });
  }

  const unit = matches[0];
  const [leasesRes, salesRes, bookingsRes, receivablesRes] = await Promise.all([
    supabase.from("lease_contracts").select("id, customer_id, contract_no, start_date, expected_end_date, paid_through_date, monthly_rent_xof, status").eq("unit_id", unit.id).eq("status", "active").limit(5),
    supabase.from("sale_contracts").select("id, customer_id, contract_no, signed_date, transfer_status, total_amount_xof, status").eq("unit_id", unit.id).eq("status", "active").limit(5),
    supabase.from("daily_bookings").select("id, customer_id, check_in, check_out, checkout_mode, actual_check_out, final_amount_xof, total_amount_xof, prepaid_amount_xof, status").eq("unit_id", unit.id).neq("status", "cancelled").order("check_in", { ascending: false }).limit(5),
    supabase.from("receivables").select("id, building_id, unit_id, customer_id, source_type, source_id, category, title, due_date, amount_xof, paid_amount_xof, status, management_status, currency, created_at, updated_at").eq("unit_id", unit.id).eq("management_status", "managed").neq("status", "cancelled").limit(500),
  ]);
  for (const [label, result] of [["长租合同", leasesRes], ["出售合同", salesRes], ["日租订单", bookingsRes], ["应收", receivablesRes]] as const) {
    if (result.error) throw new Error(`读取${label}失败：${result.error.message}`);
  }

  const activeDaily = (bookingsRes.data ?? []).filter((row) => ["pending_review", "confirmed", "checked_in"].includes(row.status));
  const activeSources = [...(leasesRes.data ?? []), ...(salesRes.data ?? []), ...activeDaily];
  const customerIds = [...new Set(activeSources.map((row) => row.customer_id).filter(Boolean))];
  const customersRes = customerIds.length ? await supabase.from("customers").select("id, name").in("id", customerIds) : { data: [], error: null };
  if (customersRes.error) throw new Error(`读取客户失败：${customersRes.error.message}`);
  const customers = new Map(((customersRes.data ?? []) as CustomerSummary[]).map((row) => [row.id, row.name]));
  const receivables = (receivablesRes.data ?? []) as unknown as ReceivableRow[];

  const financialFor = (sourceType: ReceivableRow["source_type"], sourceId: string) => {
    const related = receivables.filter((row) => row.source_type === sourceType && row.source_id === sourceId);
    return {
      amount: related.reduce((sum, row) => sum + Number(row.amount_xof), 0),
      paid: related.reduce((sum, row) => sum + Number(row.paid_amount_xof), 0),
      outstanding: related.reduce((sum, row) => sum + receivableOutstanding(row), 0),
    };
  };
  const rows: Array<Record<string, string>> = [];
  for (const contract of leasesRes.data ?? []) {
    const finance = financialFor("lease_contract", contract.id);
    rows.push({ business: "长租", reference: contract.contract_no, customer: customers.get(contract.customer_id) ?? "—", status: "生效中", dates: `${contract.start_date ?? "—"} · 已缴至 ${contract.paid_through_date ?? "待确认"}`, contractAmount: formatXof(contract.monthly_rent_xof) + "/月", paid: formatXof(finance.paid), outstanding: formatXof(finance.outstanding) });
  }
  for (const contract of salesRes.data ?? []) {
    const finance = financialFor("sale_contract", contract.id);
    rows.push({ business: "出售", reference: contract.contract_no, customer: customers.get(contract.customer_id) ?? "—", status: `生效中 · 过户${statusLabel(contract.transfer_status)}`, dates: contract.signed_date, contractAmount: formatXof(contract.total_amount_xof), paid: formatXof(finance.paid), outstanding: formatXof(finance.outstanding) });
  }
  for (const booking of activeDaily) {
    const finance = financialFor("daily_booking", booking.id);
    rows.push({ business: "日租", reference: `订单 ${booking.id.slice(0, 8)}`, customer: customers.get(booking.customer_id) || "—", status: statusDisplayLabel(booking.status, "zh"), dates: `${booking.check_in} 至 ${booking.actual_check_out ?? booking.check_out ?? "未定"}`, contractAmount: formatXof(booking.final_amount_xof ?? booking.total_amount_xof), paid: formatXof(finance.paid || booking.prepaid_amount_xof), outstanding: formatXof(finance.outstanding) });
  }

  const totalOutstanding = receivables.reduce((sum, row) => sum + receivableOutstanding(row), 0);
  const overdue = receivables.filter((row) => isReceivableOverdue(row, intent.asOfDate)).reduce((sum, row) => sum + receivableOutstanding(row), 0);
  const building = buildingMap.get(unit.building_id);
  const label = `${building?.code.replace("SACSI", "") ?? "?"}#${unit.unit_no}`;

  return toResult({
    query,
    intent,
    title: `${label} 房源快照`,
    answer: `${label}当前房态为“${statusLabel(unit.status)}”，共有 ${rows.length} 项生效或进行中的业务记录；已确认未收 ${formatXof(totalOutstanding)}，其中逾期 ${formatXof(overdue)}。`,
    scope: `${buildingLabel(building)} · ${unit.unit_no}`,
    metrics: [
      { label: "当前房态", value: statusLabel(unit.status), tone: "blue" },
      { label: "进行中业务", value: String(rows.length), tone: rows.length ? "purple" : "neutral" },
      { label: "已确认未收", value: formatXof(totalOutstanding), tone: totalOutstanding ? "amber" : "green" },
      { label: "逾期", value: formatXof(overdue), tone: overdue ? "red" : "green" },
    ],
    table: {
      columns: [
        { key: "business", label: "业务" }, { key: "reference", label: "编号" }, { key: "customer", label: "客户" },
        { key: "status", label: "状态" }, { key: "dates", label: "关键日期" }, { key: "contractAmount", label: "约定金额", align: "right" },
        { key: "paid", label: "已收", align: "right" }, { key: "outstanding", label: "未收", align: "right" },
      ],
      rows,
    },
    evidence: [
      { label: "业务口径", value: "长租、出售仅展示生效合同；日租展示待确认、已确认或已入住订单" },
      { label: "财务口径", value: "金额来自该房源已确认管理且未取消的应收记录，不用合同总价倒推历史欠款" },
    ],
    warnings: receivables.some((row) => row.management_status === "historical_pending") ? ["该房源仍有历史待核应收，未计入金额。"] : [],
    resultCount: rows.length,
  });
}

export async function executeWorkbenchQuery(query: string, intent: WorkbenchIntent): Promise<WorkbenchResult> {
  if (intent.kind === "daily_status") return queryDailyStatus(query, intent);
  if (["receivable_overdue", "receivable_outstanding", "receivable_due_soon"].includes(intent.kind)) return queryReceivables(query, intent);
  if (intent.kind === "unit_snapshot" && intent.unitNo) return queryUnitSnapshot(query, intent);

  return toResult({
    query,
    intent,
    title: "暂不支持这个问题",
    answer: "当前工作台只回答可由系统固定口径验证的日租房态、未收/逾期/近期应缴，以及指定房源快照。",
    scope: "受控查询范围",
    metrics: [],
    table: null,
    warnings: ["可以尝试：今天日租房态、11#长租逾期、出售15天内应缴、查看11#503的合同和收款。"],
    resultCount: 0,
  });
}
