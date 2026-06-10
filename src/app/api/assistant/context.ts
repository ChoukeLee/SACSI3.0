import { createClient } from "@/lib/supabase/server";

export type AssistantIntent =
  | "general_chat"
  | "daily_today_overview"
  | "daily_today_checkouts"
  | "daily_today_checkins"
  | "daily_cleaning_tasks"
  | "daily_available_rooms"
  | "room_profile"
  | "finance_receivables"
  | "audit_activity"
  | "business_draft"
  | "unknown";

export interface AssistantUser {
  role?: string;
  displayName?: string;
  email?: string;
}

export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantDraft {
  action: "complete_cleaning" | "record_payment" | "check_in" | "check_out";
  room_no?: string;
  room?: string;
  unit_id?: string;
  booking_id?: string;
  cleaning_task_id?: string;
  amount_xof?: number;
  date?: string;
  note?: string;
  missing?: string[];
}

export interface BusinessToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  data: T;
  rowCount: number;
  missingFields: string[];
  warnings: string[];
  sourceTables: string[];
}

export interface AssistantContext {
  date: string;
  user: { name: string; role: string };
  project: string;
  intent: AssistantIntent;
  roomNumbers: string[];
  toolContext: BusinessToolResult | Record<string, unknown>;
  toolResults: BusinessToolResult[];
  facts: string[];
  warnings: string[];
  draft?: AssistantDraft | null;
}

const today = () => new Date().toISOString().slice(0, 10);
const monthPrefix = () => today().slice(0, 7);

const ACTIVE_DAILY_STATUSES = ["pending_review", "confirmed", "checked_in", "checked_out"];
const OPEN_DAILY_STATUSES = ["pending_review", "confirmed", "checked_in"];

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toolResult<T>(
  tool: string,
  data: T,
  options: {
    rowCount?: number;
    missingFields?: string[];
    warnings?: string[];
    sourceTables?: string[];
  } = {},
): BusinessToolResult<T> {
  const rowCount = options.rowCount ?? (Array.isArray(data) ? data.length : 1);
  const missingFields = uniq(options.missingFields ?? []);
  const warnings = uniq(options.warnings ?? []);
  return {
    ok: missingFields.length === 0,
    tool,
    data,
    rowCount,
    missingFields,
    warnings,
    sourceTables: options.sourceTables ?? [],
  };
}

function findMissingFields(
  rows: Record<string, unknown>[],
  fields: string[],
  rowLabel: (row: Record<string, unknown>, index: number) => string,
): string[] {
  const missing: string[] = [];
  rows.forEach((row, index) => {
    for (const field of fields) {
      if (row[field] === null || row[field] === undefined || row[field] === "") {
        missing.push(`${rowLabel(row, index)}.${field}`);
      }
    }
  });
  return missing;
}

function syncToolResult(ctx: AssistantContext, result: BusinessToolResult) {
  ctx.toolResults.push(result);
  ctx.warnings.push(...result.warnings);
  if (result.missingFields.length > 0) {
    ctx.warnings.push(`${result.tool} missing fields: ${result.missingFields.join(", ")}`);
  }
}

function extractRoomNumbers(text: string): string[] {
  return uniq([...text.matchAll(/\b(\d{3,4})\b/g)].map((m) => m[1]));
}

function extractAmountXof(text: string): number | undefined {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(万|w|W)?/);
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;
  return Math.round(base * (match[2] ? 10000 : 1));
}

function recentHistoryRooms(history?: HistoryEntry[]): string[] {
  if (!history) return [];
  for (const item of history.slice(-10).reverse()) {
    if (item.role !== "user") continue;
    const rooms = extractRoomNumbers(item.content);
    if (rooms.length > 0) return rooms;
  }
  return [];
}

function inferFollowUpIntent(message: string, history?: HistoryEntry[]): AssistantIntent | null {
  if (!history) return null;
  const vague = /能查|查到|具体|明细|房间号|是哪|哪些|继续|看得到|看到吗|它|他们|这个|那个|can you|details|which/i.test(message);
  if (!vague) return null;

  for (const item of history.slice(-10).reverse()) {
    if (item.role !== "user") continue;
    const text = item.content.toLowerCase();
    if (/退房|离店|check.?out|checkout|départ|depart/i.test(text)) return "daily_today_checkouts";
    if (/入住|到店|check.?in|arriv/i.test(text)) return "daily_today_checkins";
    if (/清洁|保洁|打扫|menage|ménage|clean/i.test(text)) return "daily_cleaning_tasks";
    if (/空房|可住|可入住|能入住|可以入住|可订|available|disponible/i.test(text)) return "daily_available_rooms";
    if (/审计|日志|操作|谁.*点|谁.*做|谁.*改|audit|historique|qui a/i.test(text)) return "audit_activity";
  }
  return null;
}

function isQuestionLike(text: string): boolean {
  return /哪些|哪个|多少|几|谁|为什么|怎么|如何|吗|有没有|是否|什么|where|what|who|why|how|which|combien|qui|quoi|pourquoi|comment|quel/i.test(text);
}

export function detectAssistantIntent(message: string, history?: HistoryEntry[]): {
  intent: AssistantIntent;
  roomNumbers: string[];
  amountXof?: number;
} {
  const text = message.trim();
  const lower = text.toLowerCase();
  const explicitRooms = extractRoomNumbers(text);
  const inheritedRooms = explicitRooms.length > 0 ? [] : recentHistoryRooms(history);
  const roomNumbers = uniq([...explicitRooms, ...inheritedRooms]);
  const amountXof = extractAmountXof(text);
  const followUpIntent = inferFollowUpIntent(text, history);
  if (followUpIntent) return { intent: followUpIntent, roomNumbers, amountXof };

  const asksHelp = /你能做|帮.*做|怎么用|功能|介绍|解释|help|aide|que peux|comment/i.test(lower);
  if (asksHelp) return { intent: "general_chat", roomNumbers, amountXof };

  const wantsCheckout =
    /退房|离店|check.?out|checkout|départ|depart/i.test(lower) &&
    /(今天|今日|today|aujourd|有哪些|哪些|谁|几|多少)/i.test(lower);
  if (wantsCheckout) return { intent: "daily_today_checkouts", roomNumbers, amountXof };

  const wantsCheckin =
    /入住|到店|check.?in|arriv/i.test(lower) &&
    /(今天|今日|today|aujourd|有哪些|哪些|谁|几|多少)/i.test(lower);
  if (wantsCheckin) return { intent: "daily_today_checkins", roomNumbers, amountXof };

  const wantsCleaning =
    /清洁|保洁|打扫|menage|ménage|clean/i.test(lower) &&
    !(/完成|done|fait|termin/i.test(lower) && roomNumbers.length > 0 && !isQuestionLike(lower));
  if (wantsCleaning) return { intent: "daily_cleaning_tasks", roomNumbers, amountXof };

  const wantsAvailable =
    /空房|可住|可入住|能入住|可以入住|可订|available|disponible/i.test(lower) &&
    !/为什么|怎么|为何/.test(lower);
  if (wantsAvailable) return { intent: "daily_available_rooms", roomNumbers, amountXof };

  const isDraft =
    roomNumbers.length > 0 &&
    !isQuestionLike(lower) &&
    (/完成.*(清洁|保洁)|((清洁|保洁).*(完成|done|fait|termin))|收到|收了|收款|租金|押金|付款|payment|paiement|loyer|办理入住|入住|办理退房|退房/i.test(lower));
  if (isDraft) return { intent: "business_draft", roomNumbers, amountXof };

  const wantsAudit = /审计|日志|操作|谁.*点|谁.*做|谁.*改|前台.*做|最近.*操作|audit|historique|qui a/i.test(lower);
  if (wantsAudit) return { intent: "audit_activity", roomNumbers, amountXof };

  const wantsFinance = /欠款|应收|已收|收款|付款|租金|押金|交到|金额|财务|receipt|收据|payment|paiement|loyer|creance|créance/i.test(lower);
  if (wantsFinance && roomNumbers.length === 0) return { intent: "finance_receivables", roomNumbers, amountXof };

  if (roomNumbers.length > 0) return { intent: "room_profile", roomNumbers, amountXof };
  if (/今天|今日|概况|情况|重点|today|aujourd|overview|résumé|resume/i.test(lower)) {
    return { intent: "daily_today_overview", roomNumbers, amountXof };
  }

  return { intent: "general_chat", roomNumbers, amountXof };
}

async function getPaymentsByBookingIds(bookingIds: string[]) {
  if (bookingIds.length === 0) return new Map<string, Record<string, unknown>[]>();
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("id, source_id, amount, currency, exchange_rate_to_xof, payment_date, receipt_no")
    .eq("source_type", "daily_booking")
    .in("source_id", bookingIds);
  const map = new Map<string, Record<string, unknown>[]>();
  for (const payment of (data ?? []) as Record<string, unknown>[]) {
    const key = String(payment.source_id ?? "");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(payment);
  }
  return map;
}

async function getCleaningByUnitIds(unitIds: string[]) {
  if (unitIds.length === 0) return new Map<string, Record<string, unknown>[]>();
  const supabase = await createClient();
  const { data } = await supabase
    .from("cleaning_tasks")
    .select("id, unit_id, daily_booking_id, is_completed, completed_at, created_at")
    .in("unit_id", unitIds)
    .order("created_at", { ascending: false });
  const map = new Map<string, Record<string, unknown>[]>();
  for (const task of (data ?? []) as Record<string, unknown>[]) {
    const key = String(task.unit_id ?? "");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(task);
  }
  return map;
}

async function getUnitsByIds(unitIds: string[]) {
  if (unitIds.length === 0) return new Map<string, Record<string, unknown>>();
  const supabase = await createClient();
  const { data } = await supabase
    .from("units")
    .select("id, unit_no, status, floor_label, kind")
    .in("id", uniq(unitIds));
  return new Map(((data ?? []) as Record<string, unknown>[]).map((unit) => [String(unit.id), unit]));
}

async function getCustomersByIds(customerIds: string[]) {
  if (customerIds.length === 0) return new Map<string, Record<string, unknown>>();
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, name, phone")
    .in("id", uniq(customerIds));
  return new Map(((data ?? []) as Record<string, unknown>[]).map((customer) => [String(customer.id), customer]));
}

function relatedObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  return (value as Record<string, unknown> | null) ?? null;
}

function summarizeDailyBooking(
  row: Record<string, unknown>,
  payments: Record<string, unknown>[],
  cleanings: Record<string, unknown>[],
  unitFallback?: Record<string, unknown>,
  customerFallback?: Record<string, unknown>,
) {
  const unit = relatedObject(row.units) ?? unitFallback ?? null;
  const customer = relatedObject(row.customers) ?? customerFallback ?? null;
  const paid = payments.reduce((sum, payment) => {
    return sum + numberOrZero(payment.amount) * (numberOrZero(payment.exchange_rate_to_xof) || 1);
  }, 0);
  const finalAmount = numberOrZero(row.final_amount_xof) || numberOrZero(row.total_amount_xof);
  const openCleaning = cleanings.find((task) => task.is_completed === false);
  const completedCleaning = cleanings.find((task) => task.is_completed === true);
  const cleaningStatus = openCleaning ? "pending" : completedCleaning ? "completed" : "none";

  return {
    room_no: unit?.unit_no ?? row.unit_no ?? null,
    unit_id: row.unit_id,
    booking_id: row.id,
    customer_name: customer?.name ?? null,
    customer_phone: customer?.phone ?? null,
    check_in: row.check_in,
    check_out: row.check_out,
    actual_check_out: row.actual_check_out,
    status: row.status,
    total_amount_xof: row.total_amount_xof,
    final_amount_xof: row.final_amount_xof,
    paid_amount_xof: paid || numberOrZero(row.prepaid_amount_xof),
    remaining_amount_xof: Math.max(0, finalAmount - (paid || numberOrZero(row.prepaid_amount_xof))),
    cleaning_status: cleaningStatus,
    cleaning_task_id: openCleaning?.id ?? completedCleaning?.id ?? null,
  };
}

export async function getTodayDailyCheckouts() {
  const supabase = await createClient();
  const date = today();
  const { data } = await supabase
    .from("daily_bookings")
    .select("*, units(id, unit_no, status, floor_label), customers(id, name, phone)")
    .eq("check_out", date)
    .in("status", ACTIVE_DAILY_STATUSES)
    .order("check_out", { ascending: true });

  const rows = (data ?? []) as Record<string, unknown>[];
  const bookingIds = rows.map((r) => String(r.id));
  const unitIds = rows.map((r) => String(r.unit_id));
  const customerIds = rows.map((r) => String(r.customer_id ?? "")).filter(Boolean);
  const [payments, cleanings, units, customers] = await Promise.all([
    getPaymentsByBookingIds(bookingIds),
    getCleaningByUnitIds(unitIds),
    getUnitsByIds(unitIds),
    getCustomersByIds(customerIds),
  ]);

  return rows.map((row) =>
    summarizeDailyBooking(
      row,
      payments.get(String(row.id)) ?? [],
      cleanings.get(String(row.unit_id)) ?? [],
      units.get(String(row.unit_id)),
      customers.get(String(row.customer_id)),
    ),
  );
}

export async function getTodayDailyCheckins() {
  const supabase = await createClient();
  const date = today();
  const { data } = await supabase
    .from("daily_bookings")
    .select("*, units(id, unit_no, status, floor_label), customers(id, name, phone)")
    .eq("check_in", date)
    .in("status", OPEN_DAILY_STATUSES)
    .order("check_in", { ascending: true });

  const rows = (data ?? []) as Record<string, unknown>[];
  const bookingIds = rows.map((r) => String(r.id));
  const unitIds = rows.map((r) => String(r.unit_id));
  const customerIds = rows.map((r) => String(r.customer_id ?? "")).filter(Boolean);
  const [payments, cleanings, units, customers] = await Promise.all([
    getPaymentsByBookingIds(bookingIds),
    getCleaningByUnitIds(unitIds),
    getUnitsByIds(unitIds),
    getCustomersByIds(customerIds),
  ]);
  return rows.map((row) => summarizeDailyBooking(
    row,
    payments.get(String(row.id)) ?? [],
    cleanings.get(String(row.unit_id)) ?? [],
    units.get(String(row.unit_id)),
    customers.get(String(row.customer_id)),
  ));
}

export async function getCleaningTasks(roomNo?: string) {
  const supabase = await createClient();
  const date = today();
  let query = supabase
    .from("cleaning_tasks")
    .select("id, unit_id, daily_booking_id, is_completed, completed_at, created_at, units(id, unit_no, status, floor_label)")
    .or(`is_completed.eq.false,completed_at.gte.${date}`)
    .order("is_completed", { ascending: true })
    .order("created_at", { ascending: false });

  if (roomNo) {
    const { data: unit } = await supabase.from("units").select("id").eq("unit_no", roomNo).maybeSingle();
    if (!unit) return [];
    query = query.eq("unit_id", unit.id);
  }

  const { data } = await query.limit(80);
  const tasks = (data ?? []) as Record<string, unknown>[];
  return tasks.map((task) => {
    const unit = task.units as Record<string, unknown> | null;
    return {
      id: task.id,
      room_no: unit?.unit_no ?? null,
      unit_id: task.unit_id,
      daily_booking_id: task.daily_booking_id,
      is_completed: task.is_completed,
      completed_at: task.completed_at,
      created_at: task.created_at,
      unit_status: unit?.status ?? null,
    };
  });
}

export async function getAvailableDailyRooms() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("units")
    .select("id, unit_no, floor_label, status, kind, unit_business_flags!inner(business_type, is_enabled)")
    .eq("unit_business_flags.business_type", "daily_rental")
    .eq("unit_business_flags.is_enabled", true)
    .eq("status", "available")
    .order("unit_no");
  return ((data ?? []) as Record<string, unknown>[]).map((unit) => ({
    unit_id: unit.id,
    room_no: unit.unit_no,
    floor_label: unit.floor_label,
    status: unit.status,
    kind: unit.kind,
  }));
}

export async function getRoomFullProfile(roomNo: string) {
  const supabase = await createClient();
  const { data: unit } = await supabase
    .from("units")
    .select("*, unit_business_flags(business_type, is_enabled, default_price_xof)")
    .eq("unit_no", roomNo)
    .maybeSingle();
  if (!unit) return null;

  const auditSelect = "id, action, entity_type, entity_id, entity_label, actor_email, actor_role, created_at, metadata";
  const [
    { data: daily },
    { data: lease },
    { data: sale },
    { data: receivables },
    { data: payments },
    { data: attachments },
    { data: cleaning },
    { data: unitAudit },
    { data: metaAudit },
  ] = await Promise.all([
    supabase.from("daily_bookings").select("*, customers(id, name, phone)").eq("unit_id", unit.id).in("status", OPEN_DAILY_STATUSES).order("check_in", { ascending: false }).limit(3),
    supabase.from("lease_contracts").select("*, customers(id, name, phone)").eq("unit_id", unit.id).eq("status", "active").order("start_date", { ascending: false }).limit(3),
    supabase.from("sale_contracts").select("*, customers(id, name, phone)").eq("unit_id", unit.id).eq("status", "active").order("signed_date", { ascending: false }).limit(3),
    supabase.from("receivables").select("*").eq("unit_id", unit.id).neq("status", "cancelled").order("due_date", { ascending: false }).limit(20),
    supabase.from("payments").select("*").eq("unit_id", unit.id).order("payment_date", { ascending: false }).limit(20),
    supabase.from("attachments").select("id, unit_id, customer_id, linked_type, linked_id, file_type, storage_path, ocr_provider, paper_archive_status, paper_archive_location, uploaded_at, metadata").eq("unit_id", unit.id).order("uploaded_at", { ascending: false }).limit(10),
    supabase.from("cleaning_tasks").select("*").eq("unit_id", unit.id).order("created_at", { ascending: false }).limit(10),
    supabase.from("audit_logs").select(auditSelect).eq("entity_id", unit.id).order("created_at", { ascending: false }).limit(10),
    supabase.from("audit_logs").select(auditSelect).contains("metadata", { unit_no: roomNo }).order("created_at", { ascending: false }).limit(10),
  ]);

  const auditLogs = [...((unitAudit ?? []) as Record<string, unknown>[]), ...((metaAudit ?? []) as Record<string, unknown>[])]
    .filter((log, index, all) => all.findIndex((item) => item.id === log.id) === index)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, 15);

  return {
    unit,
    daily: daily ?? [],
    lease: lease ?? [],
    sale: sale ?? [],
    receivables: receivables ?? [],
    payments: payments ?? [],
    attachments: attachments ?? [],
    cleaning: cleaning ?? [],
    audit_logs: auditLogs,
  };
}

export async function getAuditActivity(input: { roomNo?: string; todayOnly?: boolean }) {
  const supabase = await createClient();
  const auditSelect = "id, action, entity_type, entity_id, entity_label, actor_email, actor_role, created_at, metadata";
  let query = supabase.from("audit_logs").select(auditSelect).order("created_at", { ascending: false }).limit(80);
  if (input.todayOnly !== false) query = query.gte("created_at", today());
  const { data } = await query;
  let logs = (data ?? []) as Record<string, unknown>[];

  if (input.roomNo) {
    const roomNo = input.roomNo;
    logs = logs.filter((log) => {
      const meta = (log.metadata ?? {}) as Record<string, unknown>;
      return (
        meta.unit_no === roomNo ||
        meta.room_no === roomNo ||
        String(log.entity_label ?? "").includes(roomNo)
      );
    });
  }

  return logs.slice(0, 30).map((log) => {
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    return {
      id: log.id,
      action: log.action,
      entity_type: log.entity_type,
      entity_label: log.entity_label ?? meta.entity_label ?? null,
      room_no: meta.unit_no ?? meta.room_no ?? null,
      actor_email: log.actor_email ?? meta.actor_email ?? null,
      actor_role: log.actor_role ?? meta.actor_role ?? null,
      actor_display_name: meta.actor_display_name ?? meta.operator_name ?? meta.operator ?? null,
      created_at: log.created_at,
      metadata: meta,
    };
  });
}

export async function getFinanceReceivables(roomNo?: string) {
  const supabase = await createClient();
  let unitId: string | undefined;
  if (roomNo) {
    const { data: unit } = await supabase.from("units").select("id").eq("unit_no", roomNo).maybeSingle();
    unitId = unit?.id;
    if (!unitId) return [];
  }

  let query = supabase
    .from("receivables")
    .select("*, units(unit_no), customers(name, phone)")
    .not("status", "in", "(paid,cancelled)")
    .order("due_date", { ascending: true })
    .limit(80);
  if (unitId) query = query.eq("unit_id", unitId);

  const { data } = await query;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const unit = row.units as Record<string, unknown> | null;
    const customer = row.customers as Record<string, unknown> | null;
    return {
      id: row.id,
      room_no: unit?.unit_no ?? null,
      customer_name: customer?.name ?? null,
      source_type: row.source_type,
      category: row.category,
      title: row.title,
      due_date: row.due_date,
      amount_xof: row.amount_xof,
      paid_amount_xof: row.paid_amount_xof,
      outstanding_xof: Math.max(0, numberOrZero(row.amount_xof) - numberOrZero(row.paid_amount_xof)),
      status: row.status,
    };
  });
}

async function buildDraft(message: string, roomNo: string, amountXof?: number): Promise<AssistantDraft> {
  const profile = await getRoomFullProfile(roomNo);
  const unit = profile?.unit as Record<string, unknown> | undefined;
  const activeDaily = (profile?.daily as Record<string, unknown>[] | undefined)?.[0];
  const pendingCleaning = (profile?.cleaning as Record<string, unknown>[] | undefined)?.find((task) => task.is_completed === false);
  const lower = message.toLowerCase();
  const date = today();

  if (/清洁|保洁|menage|ménage|clean/i.test(lower)) {
    return {
      action: "complete_cleaning",
      room_no: roomNo,
      room: roomNo,
      unit_id: String(unit?.id ?? ""),
      cleaning_task_id: pendingCleaning?.id ? String(pendingCleaning.id) : undefined,
      date,
      missing: pendingCleaning ? [] : ["cleaning_task_id"],
      note: pendingCleaning ? "Pending cleaning task found." : "No pending cleaning task found for this room.",
    };
  }

  if (/收|租金|押金|付款|payment|paiement|loyer/i.test(lower)) {
    return {
      action: "record_payment",
      room_no: roomNo,
      room: roomNo,
      unit_id: String(unit?.id ?? ""),
      booking_id: activeDaily?.id ? String(activeDaily.id) : undefined,
      amount_xof: amountXof,
      date,
      missing: amountXof ? [] : ["amount_xof"],
      note: "Payment draft only. It has not been written to the database.",
    };
  }

  if (/退房|check.?out|depart|départ/i.test(lower)) {
    return {
      action: "check_out",
      room_no: roomNo,
      room: roomNo,
      unit_id: String(unit?.id ?? ""),
      booking_id: activeDaily?.id ? String(activeDaily.id) : undefined,
      date,
      missing: activeDaily ? [] : ["booking_id"],
    };
  }

  return {
    action: "check_in",
    room_no: roomNo,
    room: roomNo,
    unit_id: String(unit?.id ?? ""),
    booking_id: activeDaily?.id ? String(activeDaily.id) : undefined,
    date,
    missing: activeDaily ? [] : ["booking_id"],
  };
}

export async function buildAssistantContext(
  message: string,
  user: AssistantUser,
  locale: string,
  history?: HistoryEntry[],
): Promise<AssistantContext> {
  const detected = detectAssistantIntent(message, history);
  const ctx: AssistantContext = {
    date: today(),
    user: { name: user.displayName ?? user.email ?? "Unknown", role: user.role ?? "unknown" },
    project: "SACIS 11",
    intent: detected.intent,
    roomNumbers: detected.roomNumbers,
    toolContext: {},
    toolResults: [],
    facts: [],
    warnings: [],
    draft: null,
  };

  switch (detected.intent) {
    case "daily_today_overview": {
      const [checkouts, checkins, cleaningTasks, availableRooms] = await Promise.all([
        getTodayDailyCheckouts(),
        getTodayDailyCheckins(),
        getCleaningTasks(),
        getAvailableDailyRooms(),
      ]);
      const overview = {
        tool: "getDailyTodayOverview",
        checkouts,
        checkins,
        cleaningTasks,
        availableRooms,
      };
      const missingFields = [
        ...findMissingFields(checkouts, ["room_no"], (row, index) => `checkout[${row.booking_id ?? index}]`),
        ...findMissingFields(checkins, ["room_no"], (row, index) => `checkin[${row.booking_id ?? index}]`),
        ...findMissingFields(cleaningTasks, ["room_no"], (row, index) => `cleaning[${row.id ?? index}]`),
        ...findMissingFields(availableRooms, ["room_no"], (row, index) => `availableRoom[${row.unit_id ?? index}]`),
      ];
      const result = toolResult("getDailyTodayOverview", overview, {
        rowCount: checkouts.length + checkins.length + cleaningTasks.length + availableRooms.length,
        missingFields,
        warnings: missingFields.length > 0 ? ["今日概况工具查到记录，但部分记录缺少房号。"] : [],
        sourceTables: ["daily_bookings", "units", "customers", "payments", "cleaning_tasks", "unit_business_flags"],
      });
      syncToolResult(ctx, result);
      ctx.toolContext = result;
      ctx.facts.push(`today_daily_checkouts_count=${checkouts.length}`);
      ctx.facts.push(`today_daily_checkins_count=${checkins.length}`);
      ctx.facts.push(`cleaning_tasks_count=${cleaningTasks.length}`);
      ctx.facts.push(`available_daily_rooms_count=${availableRooms.length}`);
      break;
    }
    case "daily_today_checkouts": {
      const checkouts = await getTodayDailyCheckouts();
      const missingFields = findMissingFields(checkouts, ["room_no"], (row, index) => `checkout[${row.booking_id ?? index}]`);
      const result = toolResult("getTodayDailyCheckouts", { checkouts }, {
        rowCount: checkouts.length,
        missingFields,
        warnings: missingFields.length > 0 ? ["日租退房工具查到退房记录，但房号映射缺失。"] : [],
        sourceTables: ["daily_bookings", "units", "customers", "payments", "cleaning_tasks"],
      });
      syncToolResult(ctx, result);
      ctx.toolContext = result;
      ctx.facts.push(`today_daily_checkouts_count=${checkouts.length}`);
      break;
    }
    case "daily_today_checkins": {
      const checkins = await getTodayDailyCheckins();
      const missingFields = findMissingFields(checkins, ["room_no"], (row, index) => `checkin[${row.booking_id ?? index}]`);
      const result = toolResult("getTodayDailyCheckins", { checkins }, {
        rowCount: checkins.length,
        missingFields,
        warnings: missingFields.length > 0 ? ["日租入住工具查到入住记录，但房号映射缺失。"] : [],
        sourceTables: ["daily_bookings", "units", "customers", "payments", "cleaning_tasks"],
      });
      syncToolResult(ctx, result);
      ctx.toolContext = result;
      ctx.facts.push(`today_daily_checkins_count=${checkins.length}`);
      break;
    }
    case "daily_cleaning_tasks": {
      const tasks = await getCleaningTasks(detected.roomNumbers[0]);
      const missingFields = findMissingFields(tasks, ["room_no"], (row, index) => `cleaning[${row.id ?? index}]`);
      const result = toolResult("getCleaningTasks", { tasks }, {
        rowCount: tasks.length,
        missingFields,
        warnings: missingFields.length > 0 ? ["清洁工具查到任务，但部分任务缺少房号。"] : [],
        sourceTables: ["cleaning_tasks", "units"],
      });
      syncToolResult(ctx, result);
      ctx.toolContext = result;
      ctx.facts.push(`cleaning_tasks_count=${tasks.length}`);
      break;
    }
    case "daily_available_rooms": {
      const rooms = await getAvailableDailyRooms();
      const missingFields = findMissingFields(rooms, ["room_no"], (row, index) => `availableRoom[${row.unit_id ?? index}]`);
      const result = toolResult("getAvailableDailyRooms", { rooms }, {
        rowCount: rooms.length,
        missingFields,
        warnings: missingFields.length > 0 ? ["日租空房工具查到房源，但部分房源缺少房号。"] : [],
        sourceTables: ["units", "unit_business_flags"],
      });
      syncToolResult(ctx, result);
      ctx.toolContext = result;
      ctx.facts.push(`available_daily_rooms_count=${rooms.length}`);
      break;
    }
    case "room_profile": {
      const profiles: Record<string, unknown> = {};
      for (const roomNo of detected.roomNumbers) profiles[roomNo] = await getRoomFullProfile(roomNo);
      const missingFields = Object.entries(profiles)
        .filter(([, profile]) => !profile)
        .map(([roomNo]) => `profiles.${roomNo}`);
      const result = toolResult("getRoomFullProfile", { profiles }, {
        rowCount: Object.keys(profiles).length,
        missingFields,
        warnings: missingFields.length > 0 ? ["部分房间档案没有查到。"] : [],
        sourceTables: ["units", "unit_business_flags", "daily_bookings", "lease_contracts", "sale_contracts", "receivables", "payments", "attachments", "cleaning_tasks", "audit_logs"],
      });
      syncToolResult(ctx, result);
      ctx.toolContext = result;
      break;
    }
    case "finance_receivables": {
      const receivables = await getFinanceReceivables(detected.roomNumbers[0]);
      const missingFields = findMissingFields(receivables, ["room_no"], (row, index) => `receivable[${row.id ?? index}]`);
      const result = toolResult("getFinanceReceivables", { receivables }, {
        rowCount: receivables.length,
        missingFields,
        warnings: missingFields.length > 0 ? ["应收工具查到记录，但部分记录缺少房号。"] : [],
        sourceTables: ["receivables", "units", "customers"],
      });
      syncToolResult(ctx, result);
      ctx.toolContext = result;
      ctx.facts.push(`open_receivables_count=${receivables.length}`);
      break;
    }
    case "audit_activity": {
      const logs = await getAuditActivity({ roomNo: detected.roomNumbers[0], todayOnly: true });
      const result = toolResult("getAuditActivity", { logs }, {
        rowCount: logs.length,
        sourceTables: ["audit_logs"],
      });
      syncToolResult(ctx, result);
      ctx.toolContext = result;
      ctx.facts.push(`audit_logs_count=${logs.length}`);
      break;
    }
    case "business_draft": {
      const roomNo = detected.roomNumbers[0];
      const draft = roomNo ? await buildDraft(message, roomNo, detected.amountXof) : null;
      const profiles: Record<string, unknown> = {};
      if (roomNo) profiles[roomNo] = await getRoomFullProfile(roomNo);
      ctx.draft = draft;
      const missingFields = draft?.missing ?? (roomNo ? [] : ["room_no"]);
      const result = toolResult("buildDraft", { draft, profiles }, {
        rowCount: draft ? 1 : 0,
        missingFields,
        warnings: ["Draft only. No database write has been executed."],
        sourceTables: ["units", "daily_bookings", "cleaning_tasks", "payments", "receivables", "audit_logs"],
      });
      syncToolResult(ctx, result);
      ctx.toolContext = result;
      ctx.warnings.push("Draft only. No database write has been executed.");
      break;
    }
    default:
      {
        const result = toolResult("none", { note: locale === "fr" ? "General conversation." : "General conversation." }, {
          sourceTables: [],
        });
        syncToolResult(ctx, result);
        ctx.toolContext = result;
      }
  }

  return ctx;
}

export function buildContextPrompt(ctx: AssistantContext): string {
  return [
    "=== TOOL_CONTEXT ===",
    JSON.stringify({
      date: ctx.date,
      user: ctx.user,
      project: ctx.project,
      intent: ctx.intent,
      roomNumbers: ctx.roomNumbers,
      facts: ctx.facts,
      warnings: ctx.warnings,
      data: ctx.toolContext,
      draft: ctx.draft,
    }, null, 2),
    "=== END_TOOL_CONTEXT ===",
  ].join("\n");
}
