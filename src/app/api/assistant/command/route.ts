import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { formatXof } from "@/lib/utils";

type AssistantIntent =
  | "query_room"
  | "record_payment"
  | "check_in"
  | "check_out"
  | "complete_cleaning"
  | "unknown";

interface AssistantDraft {
  intent: AssistantIntent;
  room?: string;
  amount_xof?: number;
  date?: string;
  customer_name?: string;
  note?: string;
}

interface RoomContext {
  unit: { id: string; unit_no: string; status: string; floor_label: string; notes: string | null } | null;
  lease: { id: string; contract_no: string; start_date: string; expected_end_date: string; monthly_rent_xof: number; status: string; customer_id: string } | null;
  sale: { id: string; contract_no: string; signed_date: string; total_amount_xof: number; status: string; customer_id: string } | null;
  daily: { id: string; check_in: string; check_out: string | null; status: string; customer_id: string; total_amount_xof: number } | null;
  customer: { id: string; name: string; phone: string | null } | null;
  cleaning: { id: string; is_completed: boolean; completed_at: string | null } | null;
}

const today = () => new Date().toISOString().slice(0, 10);

function extractJson(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  try {
    return JSON.parse(raw) as AssistantDraft;
  } catch {
    return { intent: "unknown", note: text } satisfies AssistantDraft;
  }
}

function normalizeDraft(draft: AssistantDraft): AssistantDraft {
  return {
    intent: draft.intent ?? "unknown",
    room: draft.room ? String(draft.room).replace(/[^\dA-Za-z-]/g, "") : undefined,
    amount_xof: typeof draft.amount_xof === "number" ? draft.amount_xof : undefined,
    date: draft.date || undefined,
    customer_name: draft.customer_name || undefined,
    note: draft.note || undefined,
  };
}

function fallbackParse(message: string): AssistantDraft {
  const room = message.match(/\b\d{3,4}\b/)?.[0];
  const amountMatch = message.match(/(\d+(?:\.\d+)?)\s*(万|w|W)?/);
  const amount = amountMatch ? Number(amountMatch[1]) * (amountMatch[2] ? 10000 : 1) : undefined;
  const lowered = message.toLowerCase();
  if (/清洁|保洁|menage|ménage/.test(message) && /完成|done|termine|terminé/.test(lowered)) return { intent: "complete_cleaning", room, date: today() };
  if (/收|租金|押金|付款|payment|paiement/.test(message) && amount) return { intent: "record_payment", room, amount_xof: amount, date: today() };
  if (/入住|check.?in|arrive/.test(lowered)) return { intent: "check_in", room, date: today() };
  if (/退房|check.?out|depart|départ/.test(lowered)) return { intent: "check_out", room, date: today() };
  if (room) return { intent: "query_room", room };
  return { intent: "unknown" };
}

async function classifyWithDeepSeek(message: string, locale: string) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  if (!apiKey) return fallbackParse(message);

  const system = [
    "You parse real-estate back-office commands into JSON only.",
    "Supported intents: query_room, record_payment, check_in, check_out, complete_cleaning, unknown.",
    "Return JSON with keys: intent, room, amount_xof, date, customer_name, note.",
    "Convert Chinese 万 amounts to XOF integer. If date is relative or missing, omit date.",
    "Do not invent room or amount.",
  ].join("\n");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `locale=${locale}\ntoday=${today()}\nmessage=${message}` },
      ],
    }),
  });

  if (!res.ok) return fallbackParse(message);
  const data = await res.json();
  return normalizeDraft(extractJson(data?.choices?.[0]?.message?.content ?? "{}"));
}

async function getRoomContext(room: string): Promise<RoomContext> {
  const supabase = await createClient();
  const { data: unit } = await supabase
    .from("units")
    .select("id, unit_no, status, floor_label, notes")
    .eq("unit_no", room)
    .maybeSingle();

  if (!unit) return { unit: null, lease: null, sale: null, daily: null, customer: null, cleaning: null };

  const [{ data: lease }, { data: sale }, { data: daily }, { data: cleaning }] = await Promise.all([
    supabase.from("lease_contracts").select("id, contract_no, start_date, expected_end_date, monthly_rent_xof, status, customer_id").eq("unit_id", unit.id).eq("status", "active").maybeSingle(),
    supabase.from("sale_contracts").select("id, contract_no, signed_date, total_amount_xof, status, customer_id").eq("unit_id", unit.id).eq("status", "active").maybeSingle(),
    supabase.from("daily_bookings").select("id, check_in, check_out, status, customer_id, total_amount_xof").eq("unit_id", unit.id).in("status", ["checked_in", "pending_review", "reserved"]).order("check_in", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("cleaning_tasks").select("id, is_completed, completed_at").eq("unit_id", unit.id).eq("is_completed", false).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const customerId = lease?.customer_id ?? sale?.customer_id ?? daily?.customer_id;
  const { data: customer } = customerId
    ? await supabase.from("customers").select("id, name, phone").eq("id", customerId).maybeSingle()
    : { data: null };

  return { unit, lease, sale, daily, customer, cleaning };
}

function roomAnswer(ctx: RoomContext, locale: string) {
  if (!ctx.unit) return locale === "fr" ? "Aucune chambre trouvee." : "没有找到这个房间。";
  const lines = [
    `房间 ${ctx.unit.unit_no}`,
    `状态：${ctx.unit.status}`,
  ];
  if (ctx.customer) lines.push(`客户：${ctx.customer.name}${ctx.customer.phone ? ` (${ctx.customer.phone})` : ""}`);
  if (ctx.lease) lines.push(`长租：${ctx.lease.contract_no}，${ctx.lease.start_date} → ${ctx.lease.expected_end_date}，月租 ${formatXof(Number(ctx.lease.monthly_rent_xof))}`);
  if (ctx.sale) lines.push(`出售：${ctx.sale.contract_no}，总额 ${formatXof(Number(ctx.sale.total_amount_xof))}`);
  if (ctx.daily) lines.push(`日租：${ctx.daily.check_in} → ${ctx.daily.check_out ?? "未定"}，${ctx.daily.status}`);
  if (ctx.cleaning) lines.push("清洁：有未完成任务");
  return lines.join("\n");
}

function draftReply(draft: AssistantDraft, ctx: RoomContext | null) {
  if (draft.intent === "query_room" && ctx) return roomAnswer(ctx, "zh");
  if (draft.intent === "unknown") return "我还没理解这条指令。你可以说：`602 现在什么状态`、`602 收到租金150万`、`1106完成清洁`。";
  const lines = ["我准备生成操作草稿："];
  if (draft.room) lines.push(`房间：${draft.room}`);
  const labels: Record<AssistantIntent, string> = {
    query_room: "查询房间",
    record_payment: "记录收款",
    check_in: "办理入住",
    check_out: "办理退房",
    complete_cleaning: "完成清洁",
    unknown: "未知",
  };
  lines.push(`操作：${labels[draft.intent]}`);
  if (draft.amount_xof) lines.push(`金额：${formatXof(draft.amount_xof)}`);
  lines.push(`日期：${draft.date ?? today()}`);
  if (ctx?.customer) lines.push(`当前客户：${ctx.customer.name}`);
  lines.push("下一步会要求确认后再执行，不会直接改库。");
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = await req.json();
    const message = String(body.message ?? "").trim();
    const locale = String(body.locale ?? "zh");
    if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

    const draft = normalizeDraft(await classifyWithDeepSeek(message, locale));
    const ctx = draft.room ? await getRoomContext(draft.room) : null;
    const isWrite = draft.intent !== "query_room" && draft.intent !== "unknown";
    const canWrite = !isWrite || hasPermission(user, "daily_rentals:write") || hasPermission(user, "finance:write");

    return NextResponse.json({
      reply: canWrite ? draftReply(draft, ctx) : "你当前账号没有执行此类操作的权限。",
      draft,
      roomContext: ctx,
      requiresConfirmation: isWrite && canWrite,
      executable: false,
    });
  } catch (error) {
    console.error("assistant command error", error);
    return NextResponse.json({ error: "Assistant failed" }, { status: 500 });
  }
}
