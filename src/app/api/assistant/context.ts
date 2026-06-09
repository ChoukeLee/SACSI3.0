import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

export interface AssistantUser {
  role?: string;
  displayName?: string;
  email?: string;
}

export interface DailySummary {
  checkedInCount: number;
  cleaningPendingCount: number;
  cleaningDoneToday: number;
  checkoutsToday: number;
  newBookingsToday: number;
  todayPayments: { count: number; total: number };
  monthPayments: { count: number; total: number };
}

export interface RoomFullContext {
  unit: Record<string, unknown> | null;
  lease: Record<string, unknown> | null;
  sale: Record<string, unknown> | null;
  daily: Record<string, unknown> | null;
  cleaning: Record<string, unknown> | null;
  customer: Record<string, unknown> | null;
  receivables: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  recentAuditLogs: Record<string, unknown>[];
}

export interface AssistantContext {
  date: string;
  user: { name: string; role: string };
  project: string;
  modules: string[];
  dailySummary?: DailySummary;
  rooms?: Record<string, RoomFullContext>;
  customers?: Record<string, unknown>[];
  financeSnapshot?: Record<string, unknown>;
  globalAuditLogs?: Record<string, unknown>[];
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

const t = () => new Date().toISOString().slice(0, 10);
const monthPrefix = () => t().slice(0, 7);

function detectPatterns(message: string) {
  const m = message.toLowerCase();
  const roomNumbers = [...message.matchAll(/\b(\d{3,4})\b/g)].map(r => r[1]);
  return {
    wantsDailyOverview: /今天|今日|概览|情况|重点|关注|日租|退房|清洁|入住|aujourd|today|résumé|aperçu|overview|quoi de neuf|que faire/i.test(m),
    wantsRoomInfo: roomNumbers.length > 0,
    roomNumbers,
    wantsCustomerInfo: /客户|租给谁|谁租|谁在|住客|client|locataire|occupant|qui (est|loue|occupe)/i.test(m),
    wantsFinanceInfo: /财务|收款|欠款|应收|已收|金额|余额|收入|支出|finance|paiement|revenu|dette|balance|encaissé|chiffres/i.test(m),
    wantsAuditInfo: /审计|操作|谁.*做|谁.*改|最近.*操作|前台.*做|清洁.*完成|historique|audit|qui a|quand|dernière/i.test(m),
    wantsDraft: /完成|收到|入住|退房|清洁|保洁|记录.*收款|长租|出售|execute|do|fait|marque|termine/i.test(m),
    wantsHelp: /你能做|帮.*做|怎么用|解释|介绍|功能|aide|help|que faire|comment|explique/i.test(m),
  };
}

// ═══════════════════════════════════════════════
// Context loaders
// ═══════════════════════════════════════════════

async function loadDailySummary(): Promise<DailySummary> {
  const supabase = await createClient();
  const date = t();
  const month = monthPrefix();

  const [
    { count: checkedIn },
    { count: cleaningPending },
    { data: cleaningDone },
    { data: checkoutsToday },
    { data: newBookings },
    { data: todayPayments },
    { data: monthPayments },
  ] = await Promise.all([
    supabase.from("daily_bookings").select("*", { count: "exact", head: true }).eq("status", "checked_in"),
    supabase.from("cleaning_tasks").select("*", { count: "exact", head: true }).eq("is_completed", false),
    supabase.from("cleaning_tasks").select("id, unit_id").gte("completed_at", date).eq("is_completed", true),
    // Checkouts today: bookings where check_out = today, any status (checked_in, checked_out)
    supabase.from("daily_bookings").select("id, unit_id, check_out, status").eq("check_out", date).in("status", ["checked_in", "checked_out"]),
    supabase.from("daily_bookings").select("id, unit_id, check_in, status").eq("check_in", date).in("status", ["pending_review", "confirmed"]),
    supabase.from("payments").select("amount").gte("payment_date", date).lte("payment_date", date),
    supabase.from("payments").select("amount").gte("payment_date", `${month}-01`).lte("payment_date", date),
  ]);

  return {
    checkedInCount: checkedIn ?? 0,
    cleaningPendingCount: cleaningPending ?? 0,
    cleaningDoneToday: cleaningDone?.length ?? 0,
    checkoutsToday: checkoutsToday?.length ?? 0,
    newBookingsToday: newBookings?.length ?? 0,
    todayPayments: {
      count: todayPayments?.length ?? 0,
      total: todayPayments?.reduce((s, p) => s + Number(p.amount), 0) ?? 0,
    },
    monthPayments: {
      count: monthPayments?.length ?? 0,
      total: monthPayments?.reduce((s, p) => s + Number(p.amount), 0) ?? 0,
    },
  };
}

async function loadRoomContext(roomNo: string): Promise<RoomFullContext | null> {
  const supabase = await createClient();
  const { data: unit } = await supabase.from("units").select("*").eq("unit_no", roomNo).maybeSingle();
  if (!unit) return null;

  const [lease, sale, daily, cleaning, receivables, payments, recentAuditLogs] = await Promise.all([
    supabase.from("lease_contracts").select("*").eq("unit_id", unit.id).eq("status", "active").maybeSingle(),
    supabase.from("sale_contracts").select("*").eq("unit_id", unit.id).eq("status", "active").maybeSingle(),
    supabase.from("daily_bookings").select("*").eq("unit_id", unit.id).in("status", ["checked_in", "confirmed", "pending_review"]).order("check_in", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("cleaning_tasks").select("*").eq("unit_id", unit.id).eq("is_completed", false).limit(1).maybeSingle(),
    // Financial: query by unit_id only — cover daily, lease, sale, managed lease
    supabase.from("receivables").select("*").eq("unit_id", unit.id).neq("status", "cancelled").order("due_date", { ascending: false }).limit(10),
    supabase.from("payments").select("*").eq("unit_id", unit.id).order("payment_date", { ascending: false }).limit(15),
    supabase.from("audit_logs").select("id, action, entity_type, entity_id, created_at, metadata").or(`entity_id.eq.${unit.id},entity_id.ilike.%${roomNo}%`).order("created_at", { ascending: false }).limit(5),
  ]);

  const customerId = (lease?.data as Record<string, unknown> | null)?.customer_id ??
    (sale?.data as Record<string, unknown> | null)?.customer_id ??
    (daily?.data as Record<string, unknown> | null)?.customer_id;
  const { data: customer } = customerId
    ? await supabase.from("customers").select("id, name, phone, is_blacklisted").eq("id", customerId as string).maybeSingle()
    : { data: null };

  return {
    unit: unit as unknown as Record<string, unknown> | null,
    lease: (lease?.data ?? null) as Record<string, unknown> | null,
    sale: (sale?.data ?? null) as Record<string, unknown> | null,
    daily: (daily?.data ?? null) as Record<string, unknown> | null,
    cleaning: (cleaning?.data ?? null) as Record<string, unknown> | null,
    customer: customer as unknown as Record<string, unknown> | null,
    receivables: (receivables?.data ?? []) as Record<string, unknown>[],
    payments: (payments?.data ?? []) as Record<string, unknown>[],
    recentAuditLogs: (recentAuditLogs?.data ?? []) as Record<string, unknown>[],
  };
}

async function loadCustomerContext(customerName: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("*").ilike("name", `%${customerName}%`).limit(3);
  return (data ?? []) as Record<string, unknown>[];
}

async function loadGlobalAuditLogs(): Promise<Record<string, unknown>[]> {
  const supabase = await createClient();
  const date = t();
  const { data } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, created_at, metadata")
    .gte("created_at", date)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as Record<string, unknown>[];
}

// ═══════════════════════════════════════════════
// Main context builder
// ═══════════════════════════════════════════════

export async function buildAssistantContext(
  message: string,
  user: AssistantUser,
  _locale: string,
): Promise<AssistantContext> {
  const patterns = detectPatterns(message);
  const date = t();

  const ctx: AssistantContext = {
    date,
    user: { name: user.displayName ?? user.email ?? "Unknown", role: user.role ?? "unknown" },
    project: "SASCI 11# 公寓",
    modules: ["日租 (daily_rental)", "长租 (lease)", "出售 (sale)", "客户 (customer)", "财务 (finance + receivables + payments)", "保洁 (cleaning)", "审计日志 (audit_logs)"],
  };

  if (patterns.wantsDailyOverview) {
    ctx.dailySummary = await loadDailySummary();
  }

  if (patterns.wantsRoomInfo && patterns.roomNumbers.length > 0) {
    ctx.rooms = {};
    for (const roomNo of [...new Set(patterns.roomNumbers)]) {
      const roomCtx = await loadRoomContext(roomNo);
      if (roomCtx) ctx.rooms[roomNo] = roomCtx;
    }
  }

  if (patterns.wantsCustomerInfo) {
    const nameMatch = message.match(/客户[：:]\s*(\S+)|(\S+)\s*(的|租客|客户|租约)/);
    const customerName = nameMatch?.[1] ?? nameMatch?.[2];
    if (customerName) {
      ctx.customers = await loadCustomerContext(customerName);
    }
  }

  if (patterns.wantsFinanceInfo) {
    ctx.financeSnapshot = {
      dailySummary: await loadDailySummary(),
      note: "monthPayments is the sum of all payments this month",
    };
  }

  if (patterns.wantsAuditInfo) {
    ctx.globalAuditLogs = await loadGlobalAuditLogs();
  }

  if (patterns.wantsDraft && patterns.roomNumbers.length > 0 && !ctx.rooms) {
    ctx.rooms = {};
    for (const roomNo of [...new Set(patterns.roomNumbers)]) {
      const roomCtx = await loadRoomContext(roomNo);
      if (roomCtx) ctx.rooms[roomNo] = roomCtx;
    }
  }

  return ctx;
}

// ═══════════════════════════════════════════════
// Prompt builder
// ═══════════════════════════════════════════════

function auditLogSummary(log: Record<string, unknown>): string {
  const action = log.action ?? "?";
  const created = (log.created_at as string ?? "").slice(0, 19).replace("T", " ");
  const meta = log.metadata as Record<string, unknown> | undefined;
  const parts = [String(action), created];
  if (meta) {
    if (meta.unit_no) parts.push(`room=${meta.unit_no}`);
    if (meta.operator_name || meta.operator) parts.push(`by=${meta.operator_name ?? meta.operator}`);
    if (meta.customer_name) parts.push(`customer=${meta.customer_name}`);
    if (meta.amount) parts.push(`amount=${meta.amount}`);
    if (meta.prepaid_amount) parts.push(`prepaid=${meta.prepaid_amount}`);
    if (meta.final_amount) parts.push(`final=${meta.final_amount}`);
    if (meta.new_status) parts.push(`→${meta.new_status}`);
    if (meta.reason) parts.push(`reason:${String(meta.reason).slice(0, 30)}`);
  }
  return parts.join(" | ");
}

export function buildContextPrompt(ctx: AssistantContext, locale: string): string {
  const zh = locale === "zh";
  const lines: string[] = [];

  lines.push("=== BUSINESS CONTEXT (from live Supabase data) ===");
  lines.push(`Date: ${ctx.date}`);
  lines.push(`User: ${ctx.user.name} (role: ${ctx.user.role})`);
  lines.push(`Project: ${ctx.project}`);
  lines.push(`Modules: ${ctx.modules.join(", ")}`);

  if (ctx.dailySummary) {
    lines.push("");
    lines.push("--- DAILY SUMMARY ---");
    lines.push(`Currently checked in: ${ctx.dailySummary.checkedInCount} rooms`);
    lines.push(`Cleaning pending: ${ctx.dailySummary.cleaningPendingCount} rooms`);
    lines.push(`Cleaning completed today: ${ctx.dailySummary.cleaningDoneToday}`);
    lines.push(`Checkouts today: ${ctx.dailySummary.checkoutsToday} bookings (check_out = today)`);
    lines.push(`New bookings today: ${ctx.dailySummary.newBookingsToday}`);
    lines.push(`Payments today: ${ctx.dailySummary.todayPayments.count} payments, total ${ctx.dailySummary.todayPayments.total.toLocaleString()} XAF`);
    lines.push(`Payments this month: ${ctx.dailySummary.monthPayments.count} payments, total ${ctx.dailySummary.monthPayments.total.toLocaleString()} XAF`);
  }

  if (ctx.rooms) {
    lines.push("");
    lines.push("--- ROOM DETAILS ---");
    for (const [roomNo, room] of Object.entries(ctx.rooms)) {
      if (!room.unit) { lines.push(`Room ${roomNo}: NOT FOUND`); continue; }
      const u = room.unit as Record<string, unknown>;
      lines.push(`Room ${roomNo}: unit_no=${u.unit_no}, status=${u.status}, floor=${u.floor_label}, kind=${u.kind}`);
      if (room.lease) { const l = room.lease as Record<string, unknown>; lines.push(`  LEASE: ${l.contract_no}, ${l.start_date}→${l.expected_end_date}, monthly_rent=${l.monthly_rent_xof}, status=${l.status}`); }
      if (room.sale) { const s = room.sale as Record<string, unknown>; lines.push(`  SALE: ${s.contract_no}, total=${s.total_amount_xof}, status=${s.status}`); }
      if (room.daily) { const d = room.daily as Record<string, unknown>; lines.push(`  DAILY: check_in=${d.check_in}, check_out=${d.check_out ?? "open"}, status=${d.status}, total=${d.total_amount_xof}`); }
      if (room.cleaning) { lines.push(`  CLEANING: pending (is_completed=false)`); }
      if (room.customer) { const c = room.customer as Record<string, unknown>; lines.push(`  CUSTOMER: ${c.name}${c.phone ? ` (${c.phone})` : ""}${c.is_blacklisted ? " [BLACKLISTED]" : ""}`); }
      if (room.payments && (room.payments as unknown[]).length > 0) {
        const pms = room.payments as Record<string, unknown>[];
        lines.push(`  PAYMENTS (${pms.length}):`);
        for (const p of pms) lines.push(`    ${p.source_type}: ${p.amount} XAF on ${p.payment_date}`);
      }
      if (room.receivables && (room.receivables as unknown[]).length > 0) {
        const recs = room.receivables as Record<string, unknown>[];
        const total = recs.reduce((s, r) => s + (Number(r.amount_xof) || 0), 0);
        const paid = recs.reduce((s, r) => s + (Number(r.paid_amount_xof) || 0), 0);
        lines.push(`  RECEIVABLES (${recs.length}): total=${total.toLocaleString()}, paid=${paid.toLocaleString()}, outstanding=${(total - paid).toLocaleString()}`);
      }
      if (room.recentAuditLogs && (room.recentAuditLogs as unknown[]).length > 0) {
        lines.push(`  RECENT AUDIT LOGS (${(room.recentAuditLogs as unknown[]).length}):`);
        for (const log of room.recentAuditLogs) {
          lines.push(`    ${auditLogSummary(log)}`);
        }
      }
    }
  }

  if (ctx.customers && ctx.customers.length > 0) {
    lines.push("");
    lines.push("--- CUSTOMERS ---");
    for (const c of ctx.customers) {
      const cust = c as Record<string, unknown>;
      lines.push(`${cust.name} (${cust.phone ?? "no phone"})${cust.is_blacklisted ? " [BLACKLISTED]" : ""}`);
    }
  }

  if (ctx.globalAuditLogs && ctx.globalAuditLogs.length > 0) {
    lines.push("");
    lines.push("--- GLOBAL AUDIT LOGS (today) ---");
    for (const log of ctx.globalAuditLogs) {
      lines.push(`  ${auditLogSummary(log)}`);
    }
  }

  lines.push("");
  lines.push("=== END BUSINESS CONTEXT ===");

  return lines.join("\n");
}
