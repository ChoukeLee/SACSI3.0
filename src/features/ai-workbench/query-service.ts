import "server-only";

import { createClient } from "@/lib/supabase/server";
import { financialBusinessLabel, statusDisplayLabel } from "@/lib/display-labels";
import { addIsoDays, isReceivableOverdue, receivableOutstanding } from "@/features/finance/metrics";
import { buildDailyRoomStateMap } from "@/features/daily-rentals/room-status";
import { formatXof, sortUnits } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
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

function tr(locale: Locale, zh: string, fr: string) {
  return locale === "fr" ? fr : zh;
}

function domainLabel(locale: Locale, domain: WorkbenchDomain) {
  return tr(
    locale,
    { all: "全部业务", daily: "日租", lease: "长租", sale: "出售" }[domain],
    { all: "Tous les secteurs", daily: "Location journalière", lease: "Bail longue durée", sale: "Vente" }[domain],
  );
}

function buildingLabel(locale: Locale, building: BuildingSummary | undefined) {
  return building?.display_name || building?.code || tr(locale, "未归属楼栋", "Bâtiment non identifié");
}

function statusLabel(locale: Locale, status: string) {
  const zhMap: Record<string, string> = {
    occupied: "占用",
    checking_out_today: "今日离店",
    reserved: "已预订",
    cleaning: "待保洁",
    available: "可安排入住",
    maintenance: "维修",
    locked: "锁定",
  };
  const frMap: Record<string, string> = {
    occupied: "Occupée",
    checking_out_today: "Départ aujourd'hui",
    reserved: "Réservée",
    cleaning: "À nettoyer",
    available: "Disponible",
    maintenance: "En maintenance",
    locked: "Verrouillée",
  };
  return (locale === "fr" ? frMap[status] : zhMap[status]) ?? statusDisplayLabel(status, locale);
}

function generatedAtText(locale: Locale, iso: string) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "zh-CN", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function baseEvidence(locale: Locale, intent: WorkbenchIntent, generatedAt: string) {
  const sourceLabel =
    intent.source === "deepseek"
      ? tr(locale, "DeepSeek 意图分类 + 固定查询", "Classification DeepSeek + requête fixe")
      : intent.source === "openai"
        ? tr(locale, "OpenAI 意图分类 + 固定查询", "Classification OpenAI + requête fixe")
        : tr(locale, "本地规则识别 + 固定查询", "Règles locales + requête fixe");
  const abidjan = locale === "fr" ? " (Abidjan)" : "（阿比让）";
  return [
    { label: tr(locale, "数据范围", "Périmètre"), value: domainLabel(locale, intent.domain) },
    { label: tr(locale, "统计时点", "Date de référence"), value: `${intent.asOfDate}${abidjan}` },
    { label: tr(locale, "生成时间", "Généré le"), value: `${generatedAtText(locale, generatedAt)}${abidjan}` },
    { label: tr(locale, "取数方式", "Source des données"), value: tr(locale, "当前账号权限下的系统实时记录", "Enregistrements réels visibles par votre profil") },
    { label: tr(locale, "问题识别", "Détection de la demande"), value: sourceLabel },
  ];
}

function toResult(locale: Locale, input: Omit<WorkbenchResult, "kind" | "generatedAt" | "evidence"> & { evidence?: WorkbenchResult["evidence"] }): WorkbenchResult {
  const generatedAt = new Date().toISOString();
  return {
    ...input,
    kind: "query_result",
    generatedAt,
    evidence: [...baseEvidence(locale, input.intent, generatedAt), ...(input.evidence ?? [])],
  };
}

function receivableColumns(locale: Locale): WorkbenchTable["columns"] {
  const col = (key: string, zh: string, fr: string, align?: "left" | "right") => ({ key, label: tr(locale, zh, fr), align });
  return [
    col("dueDate", "到期日", "Échéance"),
    col("building", "楼栋", "Bâtiment"),
    col("unit", "房号", "Chambre"),
    col("customer", "客户", "Client"),
    col("business", "业务", "Secteur"),
    col("title", "应收项目", "Libellé"),
    col("amount", "应收", "Dû", "right"),
    col("paid", "已收", "Payé", "right"),
    col("outstanding", "未收", "Reste dû", "right"),
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

async function queryReceivables(locale: Locale, query: string, intent: WorkbenchIntent): Promise<WorkbenchResult> {
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
  if (error) throw new Error(tr(locale, `读取应收记录失败：${error.message}`, `Erreur de lecture des créances : ${error.message}`));

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
  if (unitsRes.error) throw new Error(tr(locale, `读取房源失败：${unitsRes.error.message}`, `Erreur de lecture des chambres : ${unitsRes.error.message}`));
  if (customersRes.error) throw new Error(tr(locale, `读取客户失败：${customersRes.error.message}`, `Erreur de lecture des clients : ${customersRes.error.message}`));
  if (buildingsRes.error) throw new Error(tr(locale, `读取楼栋失败：${buildingsRes.error.message}`, `Erreur de lecture des bâtiments : ${buildingsRes.error.message}`));

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
      building: buildingLabel(locale, building),
      unit: unit?.unit_no ?? "—",
      customer: customers.get(row.customer_id ?? "") ?? "—",
      business: financialBusinessLabel(row.source_type, locale, row.category),
      title: row.title,
      amount: formatXof(row.amount_xof),
      paid: formatXof(row.paid_amount_xof),
      outstanding: formatXof(receivableOutstanding(row)),
    };
  });
  const kindLabel = intent.kind === "receivable_overdue"
    ? tr(locale, "逾期", "en retard")
    : intent.kind === "receivable_due_soon"
      ? tr(locale, `${intent.days} 天内应缴`, `dû sous ${intent.days} j`)
      : tr(locale, "当前未收", "reste à encaisser");
  const scope = `${domainLabel(locale, intent.domain)} · ${intent.buildingCode ? intent.buildingCode.replace("SACSI", "") + "#" : tr(locale, "全部在管楼栋", "tous bâtiments gérés")}`;

  return toResult(locale, {
    query,
    intent,
    title: tr(locale, `${kindLabel}明细`, `Détail ${kindLabel}`),
    answer: rows.length
      ? tr(locale, `${scope}共有 ${rows.length} 笔${kindLabel}，未收合计 ${formatXof(total)}。`, `${scope} : ${rows.length} ${kindLabel}, total restant ${formatXof(total)}.`)
      : tr(locale, `${scope}没有符合口径的${kindLabel}记录。`, `${scope} : aucune créance ${kindLabel}.`),
    scope,
    metrics: [
      { label: tr(locale, "笔数", "Nombre"), value: String(rows.length), tone: rows.length ? "amber" : "green" },
      { label: tr(locale, "未收合计", "Total restant"), value: formatXof(total), tone: intent.kind === "receivable_overdue" && total > 0 ? "red" : total > 0 ? "amber" : "green" },
      ...(intent.kind === "receivable_due_soon" ? [{ label: tr(locale, "截止日期", "Date limite"), value: endDate, tone: "blue" as const }] : []),
    ],
    table: { columns: receivableColumns(locale), rows: rowData.slice(0, 100) },
    evidence: [
      { label: tr(locale, "财务口径", "Périmètre financier"), value: tr(locale, "仅统计已确认管理（managed）、未取消且未收余额大于 0 的应收", "Créances gérées (managed), non annulées et avec solde restant > 0") },
      { label: tr(locale, "合同口径", "Périmètre contractuel"), value: tr(locale, "长租和出售仅保留生效合同；日租排除已取消订单", "Baux et ventes actifs uniquement ; réservations annulées exclues") },
      { label: tr(locale, "逾期定义", "Définition du retard"), value: tr(locale, "到期日早于统计日；到期当天不算逾期", "Échéance avant la date de référence ; le jour même n'est pas en retard") },
    ],
    warnings: rows.length > 100 ? [tr(locale, `共 ${rows.length} 笔，表格仅展示前 100 笔。`, `${rows.length} créances ; 100 premières affichées.`)] : [],
    resultCount: rows.length,
  });
}

async function queryDailyStatus(locale: Locale, query: string, intent: WorkbenchIntent): Promise<WorkbenchResult> {
  const supabase = await createClient();
  let buildingQuery = supabase.from("buildings").select("id, code, display_name").eq("is_active", true);
  if (intent.buildingCode) buildingQuery = buildingQuery.eq("code", intent.buildingCode);
  const { data: buildingData, error: buildingError } = await buildingQuery;
  if (buildingError) throw new Error(tr(locale, `读取楼栋失败：${buildingError.message}`, `Erreur de lecture des bâtiments : ${buildingError.message}`));
  const buildings = (buildingData ?? []) as unknown as BuildingSummary[];
  const buildingIds = buildings.map((row) => row.id);
  if (!buildingIds.length) {
    return toResult(locale, {
      query,
      intent,
      title: tr(locale, "日租房态", "État journalier"),
      answer: tr(locale, "没有找到指定的在管楼栋。", "Aucun bâtiment géré trouvé pour ce code."),
      scope: intent.buildingCode ?? tr(locale, "全部楼栋", "Tous bâtiments"),
      metrics: [],
      table: null,
      warnings: [tr(locale, "请检查楼栋编号。", "Vérifiez le numéro du bâtiment.")],
      resultCount: 0,
    });
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
  if (unitsRes.error) throw new Error(tr(locale, `读取日租房源失败：${unitsRes.error.message}`, `Erreur de lecture des chambres journalières : ${unitsRes.error.message}`));
  if (bookingsRes.error) throw new Error(tr(locale, `读取日租订单失败：${bookingsRes.error.message}`, `Erreur de lecture des réservations : ${bookingsRes.error.message}`));
  if (cleaningRes.error) throw new Error(tr(locale, `读取保洁状态失败：${cleaningRes.error.message}`, `Erreur de lecture du ménage : ${cleaningRes.error.message}`));

  const units = sortUnits((unitsRes.data ?? []) as unknown as UnitRow[]);
  const unitIds = new Set(units.map((row) => row.id));
  const bookings = ((bookingsRes.data ?? []) as unknown as DailyBookingRow[]).filter((row) => unitIds.has(row.unit_id));
  const customerIds = [...new Set(bookings.map((row) => row.customer_id).filter(Boolean))];
  const customersRes = customerIds.length ? await supabase.from("customers").select("id, name").in("id", customerIds) : { data: [], error: null };
  if (customersRes.error) throw new Error(tr(locale, `读取客户失败：${customersRes.error.message}`, `Erreur de lecture des clients : ${customersRes.error.message}`));

  const customerNames = new Map(((customersRes.data ?? []) as CustomerSummary[]).map((row) => [row.id, row.name]));
  const buildingMap = new Map(buildings.map((row) => [row.id, row]));
  const states = buildDailyRoomStateMap({
    dailyUnits: units,
    dateStr: intent.asOfDate,
    bookings,
    cleaningTasks: cleaningRes.data ?? [],
  });
  const counts = { occupied: 0, checking_out_today: 0, reserved: 0, cleaning: 0, available: 0, maintenance: 0, locked: 0 };
  const openWord = tr(locale, "未定", "ouverte");
  const rows = units.map((unit) => {
    const state = states.get(unit.id)!;
    counts[state.status] += 1;
    const booking = state.booking;
    return {
      building: buildingLabel(locale, buildingMap.get(unit.building_id)),
      unit: unit.unit_no,
      status: statusLabel(locale, state.status),
      guest: customerNames.get(booking?.customer_id ?? "") || "—",
      period: booking ? `${booking.check_in} ${tr(locale, "至", "→")} ${booking.checkout_mode === "open" && !booking.actual_check_out ? openWord : booking.actual_check_out ?? booking.check_out ?? openWord}` : "—",
    };
  });
  const buildingScope = intent.buildingCode
    ? intent.buildingCode.replace("SACSI", "") + "#"
    : buildings.map((row) => row.code.replace("SACSI", "") + "#").join(tr(locale, "、", ", "));
  const scope = `${tr(locale, "日租", "Journalier")} · ${buildingScope}`;

  return toResult(locale, {
    query,
    intent,
    title: `${intent.asOfDate} ${tr(locale, "日租房态", "état journalier")}`,
    answer: tr(
      locale,
      `${scope}共 ${units.length} 间：占用 ${counts.occupied + counts.checking_out_today} 间，预订 ${counts.reserved} 间，待保洁 ${counts.cleaning} 间，可安排入住 ${counts.available} 间。`,
      `${scope} : ${units.length} chambres — occupées ${counts.occupied + counts.checking_out_today}, réservées ${counts.reserved}, à nettoyer ${counts.cleaning}, disponibles ${counts.available}.`,
    ),
    scope,
    metrics: [
      { label: tr(locale, "占用", "Occupées"), value: String(counts.occupied + counts.checking_out_today), tone: "blue" },
      { label: tr(locale, "今日离店", "Départs"), value: String(counts.checking_out_today), tone: "amber" },
      { label: tr(locale, "待保洁", "À nettoyer"), value: String(counts.cleaning), tone: "teal" },
      { label: tr(locale, "可安排入住", "Disponibles"), value: String(counts.available), tone: "green" },
    ],
    table: {
      columns: [
        { key: "building", label: tr(locale, "楼栋", "Bâtiment") }, { key: "unit", label: tr(locale, "房号", "Chambre") }, { key: "status", label: tr(locale, "房态", "État") },
        { key: "guest", label: tr(locale, "登记联系人", "Contact") }, { key: "period", label: tr(locale, "入住区间", "Séjour") },
      ],
      rows,
    },
    evidence: [
      { label: tr(locale, "房态口径", "Périmètre des états"), value: tr(locale, "日租启用房源；在住优先，其次待保洁、预订、维修/锁定、可安排入住", "Chambres actives en journalier ; occupée prioritaire, puis à nettoyer, réservée, maintenance/verrouillée, disponible") },
      { label: tr(locale, "订单口径", "Périmètre des réservations"), value: tr(locale, "排除已取消订单；开放式入住在未办理离店前持续占用", "Réservations annulées exclues ; séjour ouvert reste occupé sans départ") },
    ],
    warnings: [],
    resultCount: units.length,
  });
}

async function queryUnitSnapshot(locale: Locale, query: string, intent: WorkbenchIntent): Promise<WorkbenchResult> {
  const supabase = await createClient();
  const [buildingsRes, unitsRes] = await Promise.all([
    supabase.from("buildings").select("id, code, display_name").eq("is_active", true),
    supabase.from("units").select("id, building_id, unit_no, floor_label, status, code").eq("unit_no", intent.unitNo!),
  ]);
  if (buildingsRes.error) throw new Error(tr(locale, `读取楼栋失败：${buildingsRes.error.message}`, `Erreur de lecture des bâtiments : ${buildingsRes.error.message}`));
  if (unitsRes.error) throw new Error(tr(locale, `读取房源失败：${unitsRes.error.message}`, `Erreur de lecture des chambres : ${unitsRes.error.message}`));
  const buildings = (buildingsRes.data ?? []) as unknown as BuildingSummary[];
  const buildingMap = new Map(buildings.map((row) => [row.id, row]));
  let matches = (unitsRes.data ?? []) as unknown as UnitSummary[];
  if (intent.buildingCode) matches = matches.filter((row) => buildingMap.get(row.building_id)?.code.toUpperCase() === intent.buildingCode);

  if (matches.length !== 1) {
    const message = matches.length === 0
      ? tr(locale, "没有找到对应房源。", "Aucune chambre correspondante trouvée.")
      : tr(locale, "该房号存在于多个楼栋，请在问题中补充楼栋编号。", "Ce numéro existe dans plusieurs bâtiments ; précisez le bâtiment.");
    return toResult(locale, {
      query,
      intent,
      title: tr(locale, "房源定位", "Localisation de la chambre"),
      answer: message,
      scope: intent.unitNo ?? tr(locale, "未识别房号", "Numéro non reconnu"),
      metrics: [],
      table: matches.length ? {
        columns: [
          { key: "building", label: tr(locale, "楼栋", "Bâtiment") }, { key: "unit", label: tr(locale, "房号", "Chambre") }, { key: "status", label: tr(locale, "当前房态", "État actuel") },
        ],
        rows: matches.map((row) => ({ building: buildingLabel(locale, buildingMap.get(row.building_id)), unit: row.unit_no, status: statusLabel(locale, row.status) })),
      } : null,
      warnings: [matches.length ? tr(locale, "例如：查看 11#503 的合同和收款。", "Ex. : contrat et paiements du 11#503.") : tr(locale, "请检查楼栋和房号。", "Vérifiez le bâtiment et le numéro.")],
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
  const checks: Array<{ error: { message: string } | null; labelZh: string; labelFr: string }> = [
    { error: leasesRes.error, labelZh: "长租合同", labelFr: "baux" },
    { error: salesRes.error, labelZh: "出售合同", labelFr: "ventes" },
    { error: bookingsRes.error, labelZh: "日租订单", labelFr: "réservations" },
    { error: receivablesRes.error, labelZh: "应收", labelFr: "créances" },
  ];
  for (const check of checks) {
    if (check.error) throw new Error(tr(locale, `读取${check.labelZh}失败：${check.error.message}`, `Erreur de lecture des ${check.labelFr} : ${check.error.message}`));
  }

  const activeDaily = (bookingsRes.data ?? []).filter((row) => ["pending_review", "confirmed", "checked_in"].includes(row.status));
  const activeSources = [...(leasesRes.data ?? []), ...(salesRes.data ?? []), ...activeDaily];
  const customerIds = [...new Set(activeSources.map((row) => row.customer_id).filter(Boolean))];
  const customersRes = customerIds.length ? await supabase.from("customers").select("id, name").in("id", customerIds) : { data: [], error: null };
  if (customersRes.error) throw new Error(tr(locale, `读取客户失败：${customersRes.error.message}`, `Erreur de lecture des clients : ${customersRes.error.message}`));
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
  const waitLabel = tr(locale, "待确认", "à confirmer");
  const monthWord = tr(locale, "/月", "/mois");
  const rows: Array<Record<string, string>> = [];
  for (const contract of leasesRes.data ?? []) {
    const finance = financialFor("lease_contract", contract.id);
    rows.push({
      business: tr(locale, "长租", "Bail"),
      reference: contract.contract_no,
      customer: customers.get(contract.customer_id) ?? "—",
      status: tr(locale, "生效中", "Actif"),
      dates: `${contract.start_date ?? "—"} · ${tr(locale, "已缴至", "payé au")} ${contract.paid_through_date ?? waitLabel}`,
      contractAmount: formatXof(contract.monthly_rent_xof) + monthWord,
      paid: formatXof(finance.paid),
      outstanding: formatXof(finance.outstanding),
    });
  }
  for (const contract of salesRes.data ?? []) {
    const finance = financialFor("sale_contract", contract.id);
    rows.push({
      business: tr(locale, "出售", "Vente"),
      reference: contract.contract_no,
      customer: customers.get(contract.customer_id) ?? "—",
      status: `${tr(locale, "生效中", "Actif")} · ${statusLabel(locale, contract.transfer_status)}`,
      dates: contract.signed_date,
      contractAmount: formatXof(contract.total_amount_xof),
      paid: formatXof(finance.paid),
      outstanding: formatXof(finance.outstanding),
    });
  }
  for (const booking of activeDaily) {
    const finance = financialFor("daily_booking", booking.id);
    rows.push({
      business: tr(locale, "日租", "Journalier"),
      reference: `${tr(locale, "订单", "Résa")} ${booking.id.slice(0, 8)}`,
      customer: customers.get(booking.customer_id) || "—",
      status: statusDisplayLabel(booking.status, locale),
      dates: `${booking.check_in} ${tr(locale, "至", "→")} ${booking.actual_check_out ?? booking.check_out ?? tr(locale, "未定", "ouverte")}`,
      contractAmount: formatXof(booking.final_amount_xof ?? booking.total_amount_xof),
      paid: formatXof(finance.paid || booking.prepaid_amount_xof),
      outstanding: formatXof(finance.outstanding),
    });
  }

  const totalOutstanding = receivables.reduce((sum, row) => sum + receivableOutstanding(row), 0);
  const overdue = receivables.filter((row) => isReceivableOverdue(row, intent.asOfDate)).reduce((sum, row) => sum + receivableOutstanding(row), 0);
  const building = buildingMap.get(unit.building_id);
  const label = `${building?.code.replace("SACSI", "") ?? "?"}#${unit.unit_no}`;

  return toResult(locale, {
    query,
    intent,
    title: `${label} ${tr(locale, "房源快照", "aperçu de la chambre")}`,
    answer: tr(
      locale,
      `${label}当前房态为“${statusLabel(locale, unit.status)}”，共有 ${rows.length} 项生效或进行中的业务记录；已确认未收 ${formatXof(totalOutstanding)}，其中逾期 ${formatXof(overdue)}。`,
      `${label} : état « ${statusLabel(locale, unit.status)} », ${rows.length} dossier(s) actif(s) ; reste dû confirmé ${formatXof(totalOutstanding)}, dont ${formatXof(overdue)} en retard.`,
    ),
    scope: `${buildingLabel(locale, building)} · ${unit.unit_no}`,
    metrics: [
      { label: tr(locale, "当前房态", "État actuel"), value: statusLabel(locale, unit.status), tone: "blue" },
      { label: tr(locale, "进行中业务", "Dossiers actifs"), value: String(rows.length), tone: rows.length ? "purple" : "neutral" },
      { label: tr(locale, "已确认未收", "Reste dû"), value: formatXof(totalOutstanding), tone: totalOutstanding ? "amber" : "green" },
      { label: tr(locale, "逾期", "En retard"), value: formatXof(overdue), tone: overdue ? "red" : "green" },
    ],
    table: {
      columns: [
        { key: "business", label: tr(locale, "业务", "Secteur") }, { key: "reference", label: tr(locale, "编号", "Référence") }, { key: "customer", label: tr(locale, "客户", "Client") },
        { key: "status", label: tr(locale, "状态", "Statut") }, { key: "dates", label: tr(locale, "关键日期", "Dates clés") }, { key: "contractAmount", label: tr(locale, "约定金额", "Montant prévu"), align: "right" },
        { key: "paid", label: tr(locale, "已收", "Payé"), align: "right" }, { key: "outstanding", label: tr(locale, "未收", "Reste dû"), align: "right" },
      ],
      rows,
    },
    evidence: [
      { label: tr(locale, "业务口径", "Périmètre métier"), value: tr(locale, "长租、出售仅展示生效合同；日租展示待确认、已确认或已入住订单", "Baux et ventes actifs ; journalier : à confirmer, confirmé ou arrivé") },
      { label: tr(locale, "财务口径", "Périmètre financier"), value: tr(locale, "金额来自该房源已确认管理且未取消的应收记录，不用合同总价倒推历史欠款", "Montants issus des créances gérées non annulées ; pas de reconstitution depuis le prix du contrat") },
    ],
    warnings: receivables.some((row) => row.management_status === "historical_pending") ? [tr(locale, "该房源仍有历史待核应收，未计入金额。", "Créances historiques à vérifier non incluses.")] : [],
    resultCount: rows.length,
  });
}

async function queryDailyMovements(locale: Locale, query: string, intent: WorkbenchIntent): Promise<WorkbenchResult> {
  const supabase = await createClient();
  let buildingQuery = supabase.from("buildings").select("id, code, display_name").eq("is_active", true);
  if (intent.buildingCode) buildingQuery = buildingQuery.eq("code", intent.buildingCode);
  const { data: buildingData, error: buildingError } = await buildingQuery;
  if (buildingError) throw new Error(tr(locale, `读取楼栋失败：${buildingError.message}`, `Erreur de lecture des bâtiments : ${buildingError.message}`));
  const buildings = (buildingData ?? []) as unknown as BuildingSummary[];
  const buildingIds = buildings.map((row) => row.id);
  if (!buildingIds.length) {
    return toResult(locale, {
      query,
      intent,
      title: tr(locale, "今日入住退房", "Arrivées et départs du jour"),
      answer: tr(locale, "没有找到指定的在管楼栋。", "Aucun bâtiment géré trouvé pour ce code."),
      scope: intent.buildingCode ?? tr(locale, "全部楼栋", "Tous bâtiments"),
      metrics: [],
      table: null,
      warnings: [tr(locale, "请检查楼栋编号。", "Vérifiez le numéro du bâtiment.")],
      resultCount: 0,
    });
  }

  const [unitsRes, bookingsRes] = await Promise.all([
    supabase.from("units").select("id, building_id, unit_no").in("building_id", buildingIds).order("unit_no"),
    supabase.from("daily_bookings")
      .select("id, unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, status")
      .in("status", ["pending_review", "confirmed", "checked_in", "checked_out"])
      .lte("check_in", intent.asOfDate)
      .order("check_in", { ascending: false })
      .limit(1000),
  ]);
  if (unitsRes.error) throw new Error(tr(locale, `读取房源失败：${unitsRes.error.message}`, `Erreur de lecture des chambres : ${unitsRes.error.message}`));
  if (bookingsRes.error) throw new Error(tr(locale, `读取订单失败：${bookingsRes.error.message}`, `Erreur de lecture des réservations : ${bookingsRes.error.message}`));

  const units = ((unitsRes.data ?? []) as Array<{ id: string; building_id: string; unit_no: string }>).filter((row) => row.building_id && buildingIds.includes(row.building_id));
  const unitByNo = new Map(units.map((row) => [row.id, row]));
  const unitIds = new Set(units.map((row) => row.id));
  const bookings = ((bookingsRes.data ?? []) as unknown as DailyBookingRow[]).filter((row) => unitIds.has(row.unit_id));

  const customerIds = [...new Set(bookings.map((row) => row.customer_id).filter(Boolean))];
  const customersRes = customerIds.length ? await supabase.from("customers").select("id, name").in("id", customerIds) : { data: [], error: null };
  if (customersRes.error) throw new Error(tr(locale, `读取客户失败：${customersRes.error.message}`, `Erreur de lecture des clients : ${customersRes.error.message}`));
  const customerNames = new Map(((customersRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));

  const asOf = intent.asOfDate;
  const arrivals = bookings.filter((row) => ["pending_review", "confirmed", "checked_in"].includes(row.status) && row.check_in === asOf);
  const departures = bookings.filter((row) =>
    (row.status === "checked_in" && (row.actual_check_out === asOf || (row.checkout_mode === "fixed" && row.check_out === asOf)))
    || (row.status === "checked_out" && row.actual_check_out === asOf),
  );

  const rows = [
    ...arrivals.map((row) => ({ group: tr(locale, "入住", "Arrivée"), room: unitByNo.get(row.unit_id)?.unit_no ?? "—", guest: customerNames.get(row.customer_id ?? "") ?? "—", detail: tr(locale, "今日到达 · 订单待办", "Arrivée du jour") })),
    ...departures.map((row) => ({ group: row.status === "checked_out" ? tr(locale, "已退", "Parti") : tr(locale, "退房", "Départ"), room: unitByNo.get(row.unit_id)?.unit_no ?? "—", guest: customerNames.get(row.customer_id ?? "") ?? "—", detail: row.status === "checked_out" ? tr(locale, "已办理退房", "Départ enregistré") : tr(locale, "今日退房", "Départ du jour") })),
  ];
  const scope = `${tr(locale, "日租", "Journalier")} · ${intent.buildingCode ? intent.buildingCode.replace("SACSI", "") + "#" : tr(locale, "全部楼栋", "tous bâtiments")}`;

  return toResult(locale, {
    query,
    intent,
    title: `${asOf} ${tr(locale, "今日入住退房", "arrivées et départs du jour")}`,
    answer: tr(
      locale,
      `${scope}：今天安排入住 ${arrivals.length} 位，退房 ${departures.length} 位。退房后请记得安排保洁并核对房间状态。`,
      `${scope} : ${arrivals.length} arrivée(s) et ${departures.length} départ(s) aujourd'hui. Après un départ, pensez au ménage et à la vérification de la chambre.`,
    ),
    scope,
    metrics: [
      { label: tr(locale, "今日入住", "Arrivées"), value: String(arrivals.length), tone: arrivals.length ? "blue" : "green" },
      { label: tr(locale, "今日退房", "Départs"), value: String(departures.length), tone: departures.length ? "amber" : "green" },
      { label: tr(locale, "已办理退房", "Déjà partis"), value: String(departures.filter((row) => row.status === "checked_out").length), tone: "neutral" },
    ],
    table: {
      columns: [
        { key: "group", label: tr(locale, "类型", "Type") },
        { key: "room", label: tr(locale, "房号", "Chambre") },
        { key: "guest", label: tr(locale, "联系人", "Contact") },
        { key: "detail", label: tr(locale, "说明", "Détail") },
      ],
      rows: rows.slice(0, 100),
    },
    evidence: [
      { label: tr(locale, "入住口径", "Périmètre arrivées"), value: tr(locale, "订单今天到店且状态为待确认/已确认/已入住", "Réservations arrivant ce jour (à confirmer, confirmées ou arrivées)") },
      { label: tr(locale, "退房口径", "Périmètre départs"), value: tr(locale, "在住订单今天退房；已退房订单按实际退房日计入", "Séjours partant ce jour ; départs déjà enregistrés selon la date réelle") },
    ],
    warnings: [],
    resultCount: rows.length,
  });
}

async function queryLeaseExpiring(locale: Locale, query: string, intent: WorkbenchIntent): Promise<WorkbenchResult> {
  const supabase = await createClient();
  const endDate = addIsoDays(intent.asOfDate, intent.days);
  const [buildingsRes, leasesRes] = await Promise.all([
    supabase.from("buildings").select("id, code, display_name").eq("is_active", true),
    supabase.from("lease_contracts")
      .select("id, unit_id, customer_id, contract_no, start_date, expected_end_date, monthly_rent_xof, status")
      .eq("status", "active")
      .gte("expected_end_date", intent.asOfDate)
      .lte("expected_end_date", endDate)
      .order("expected_end_date", { ascending: true })
      .limit(300),
  ]);
  if (buildingsRes.error) throw new Error(tr(locale, `读取楼栋失败：${buildingsRes.error.message}`, `Erreur de lecture des bâtiments : ${buildingsRes.error.message}`));
  if (leasesRes.error) throw new Error(tr(locale, `读取长租合同失败：${leasesRes.error.message}`, `Erreur de lecture des baux : ${leasesRes.error.message}`));

  const buildings = (buildingsRes.data ?? []) as unknown as BuildingSummary[];
  const buildingMap = new Map(buildings.map((row) => [row.id, row]));
  let leases = (leasesRes.data ?? []) as Array<{ id: string; unit_id: string; customer_id: string; contract_no: string; start_date: string | null; expected_end_date: string; monthly_rent_xof: number; status: string }>;

  const unitIds = [...new Set(leases.map((row) => row.unit_id).filter(Boolean))];
  const unitsRes = unitIds.length ? await supabase.from("units").select("id, building_id, unit_no").in("id", unitIds) : { data: [], error: null };
  if (unitsRes.error) throw new Error(tr(locale, `读取房源失败：${unitsRes.error.message}`, `Erreur de lecture des chambres : ${unitsRes.error.message}`));
  const units = new Map(((unitsRes.data ?? []) as Array<{ id: string; building_id: string; unit_no: string }>).map((row) => [row.id, row]));
  const customerIds = [...new Set(leases.map((row) => row.customer_id).filter(Boolean))];
  const customersRes = customerIds.length ? await supabase.from("customers").select("id, name").in("id", customerIds) : { data: [], error: null };
  if (customersRes.error) throw new Error(tr(locale, `读取客户失败：${customersRes.error.message}`, `Erreur de lecture des clients : ${customersRes.error.message}`));
  const customerNames = new Map(((customersRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));

  if (intent.buildingCode) leases = leases.filter((row) => buildingMap.get(units.get(row.unit_id)?.building_id ?? "")?.code.toUpperCase() === intent.buildingCode);

  const daysBetween = (iso: string) => Math.max(0, Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${intent.asOfDate}T00:00:00Z`)) / 86_400_000));
  const rows = leases.map((row) => {
    const unit = units.get(row.unit_id);
    const building = buildingMap.get(unit?.building_id ?? "");
    return {
      endDate: row.expected_end_date,
      daysLeft: String(daysBetween(row.expected_end_date)),
      building: buildingLabel(locale, building),
      unit: unit?.unit_no ?? "—",
      customer: customerNames.get(row.customer_id ?? "") ?? "—",
      monthlyRent: formatXof(row.monthly_rent_xof),
      contractNo: row.contract_no,
    };
  });
  const scope = `${tr(locale, "长租", "Baux")} · ${intent.buildingCode ? intent.buildingCode.replace("SACSI", "") + "#" : tr(locale, "全部楼栋", "tous bâtiments")}`;
  const nearest = rows[0] ? `${rows[0].endDate} ${rows[0].unit}(${rows[0].customer})` : null;

  return toResult(locale, {
    query,
    intent,
    title: tr(locale, `长租 ${intent.days} 天内到期`, `Baux expirant sous ${intent.days} j`),
    answer: rows.length
      ? tr(
          locale,
          `${scope}：接下来 ${intent.days} 天有 ${rows.length} 份生效合同到期（最早 ${nearest}）。建议提前联系确认续租或安排退租，避免空置。`,
          `${scope} : ${rows.length} bail(s) actif(s) expirent sous ${intent.days} j (au plus tôt ${nearest}). Contactez le locataire pour confirmer la reconduction ou préparer le départ.`,
        )
      : tr(locale, `${scope}：未来 ${intent.days} 天没有到期合同。`, `${scope} : aucun bail n'expire sous ${intent.days} j.`),
    scope,
    metrics: [
      { label: tr(locale, "到期合同", "Baux à échéance"), value: String(rows.length), tone: rows.length ? "amber" : "green" },
      { label: tr(locale, "最早到期", "Échéance la plus proche"), value: rows[0]?.endDate ?? "—", tone: "blue" },
    ],
    table: rows.length ? {
      columns: [
        { key: "endDate", label: tr(locale, "到期日", "Échéance") },
        { key: "daysLeft", label: tr(locale, "剩余", "Jours") },
        { key: "building", label: tr(locale, "楼栋", "Bâtiment") },
        { key: "unit", label: tr(locale, "房号", "Chambre") },
        { key: "customer", label: tr(locale, "客户", "Client") },
        { key: "monthlyRent", label: tr(locale, "月租", "Loyer/mois"), align: "right" },
        { key: "contractNo", label: tr(locale, "合同号", "Contrat") },
      ],
      rows: rows.slice(0, 100),
    } : null,
    evidence: [
      { label: tr(locale, "口径", "Périmètre"), value: tr(locale, "仅统计生效中的合同，到期日落在今天到 N 天之间（含今天）", "Baux actifs dont l'échéance tombe entre aujourd'hui et N jours (aujourd'hui inclus)") },
      { label: tr(locale, "提醒", "Rappel"), value: tr(locale, "是否续租取决于人工跟进，本结果不替代催办流程", "La reconduction dépend du suivi humain ; ce résultat ne remplace pas le processus de relance") },
    ],
    warnings: rows.length > 100 ? [tr(locale, `共 ${rows.length} 份，表格仅展示前 100 份。`, `${rows.length} baux ; 100 premiers affichés.`)] : [],
    resultCount: rows.length,
  });
}

export async function executeWorkbenchQuery(query: string, intent: WorkbenchIntent, locale: Locale = "zh"): Promise<WorkbenchResult> {
  if (intent.kind === "daily_status") return queryDailyStatus(locale, query, intent);
  if (intent.kind === "daily_movements") return queryDailyMovements(locale, query, intent);
  if (intent.kind === "lease_expiring") return queryLeaseExpiring(locale, query, intent);
  if (["receivable_overdue", "receivable_outstanding", "receivable_due_soon"].includes(intent.kind)) return queryReceivables(locale, query, intent);
  if (intent.kind === "unit_snapshot" && intent.unitNo) return queryUnitSnapshot(locale, query, intent);

  return toResult(locale, {
    query,
    intent,
    title: tr(locale, "这题我暂时答不了", "Je ne peux pas encore répondre à ça"),
    answer: tr(
      locale,
      "我只做“能用系统固定口径验证”的查询，现在还不会答这一类。可以换一种问法，或直接点下方示例。查询只读、绝不改数据；想办理事项（例如“保洁已完成”）请说清房间和动作，我会先给你草稿。",
      "Je réponds uniquement aux questions vérifiables par les règles fixes du système. Reformulez votre question ou utilisez un exemple ci-dessous. Les requêtes sont en lecture seule ; pour une opération (ex. ménage terminé), précisez la chambre et l'action : je proposerai un brouillon.",
    ),
    scope: tr(locale, "受控查询范围", "Périmètre de requête contrôlé"),
    metrics: [],
    table: null,
    warnings: [tr(locale, "可以试试：今天日租房态、11#今天退房名单、11#长租逾期、长租30天内到期、出售15天内应缴、查看11#503的合同和收款、11#906保洁已完成。", "Exemples : état journalier du jour, départs du jour 11#, retards bail 11#, baux expirant sous 30 j, échéances vente sous 15 j, contrat et paiements du 11#503, ménage terminé 11#906.")],
    resultCount: 0,
  });
}
