import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { formatXof } from "@/lib/utils";

type AssistantIntent = "general_chat" | "business_query" | "business_draft" | "analytics" | "unknown";

interface ChatMessage { role: "user" | "assistant"; content: string; }

interface AssistantResult {
  reply: string;
  intent: AssistantIntent;
  draft?: Record<string, unknown> | null;
  requiresConfirmation?: boolean;
  error?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

// ═══════════════════════════════════════════════
// DeepSeek call
// ═══════════════════════════════════════════════

async function chatWithDeepSeek(
  messages: { role: string; content: string }[],
): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  if (!apiKey) return null;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.3, messages }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? null;
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  try { return JSON.parse(raw); } catch { return {}; }
}

// ═══════════════════════════════════════════════
// System prompt
// ═══════════════════════════════════════════════

function buildSystemPrompt(locale: string): string {
  return [
    "You are SACIS Assistant, a back-office operations AI for a property management system in Abidjan, Côte d'Ivoire.",
    "You help staff manage daily rentals, leases, sales, finance, cleaning, and customers.",
    "",
    "First, classify the user message into one of these intents:",
    "- general_chat: casual questions, how-to, system explanation, \"what can you do\"",
    "- business_query: asking about room status, customer info, today's tasks, cleaning, occupancy",
    "- business_draft: requesting an action like check-in, check-out, record payment, complete cleaning, mark leased/sold",
    "- analytics: asking about statistics, trends, summaries across rooms/buildings",
    "- unknown: cannot determine intent",
    "",
    "Reply in JSON format:",
    "{",
    "  \"intent\": \"<intent>\",",
    "  \"reply\": \"<natural-language reply in " + (locale === "fr" ? "French" : "Chinese") + ">\",",
    "  \"draft\": null or { \"action\": \"...\", \"room\": \"...\", \"amount_xof\": number, ... },",
    "  \"requiresConfirmation\": true or false",
    "}",
    "",
    "Rules:",
    "- For general_chat: draft=null, requiresConfirmation=false. Reply naturally like ChatGPT.",
    "- For business_query: draft=null, requiresConfirmation=false. Summarize findings clearly.",
    "- For business_draft: set draft with action/room/amount fields, requiresConfirmation=true. Explain what the draft does. NEVER claim you've already executed it.",
    "- For analytics: draft=null. Explain what data the user should check.",
    "- For unknown: draft=null. Ask the user to clarify.",
    "- Room numbers are 3-4 digits like 602, 1106, 103.",
    "- Amounts are in XOF (West African CFA franc). \"195万\" means 1,950,000.",
    "- Today is " + today() + ".",
  ].join("\n");
}

// ═══════════════════════════════════════════════
// Fallback: rule-based parse when no API key
// ═══════════════════════════════════════════════

function fallbackChat(message: string, locale: string): AssistantResult {
  const lowered = message.toLowerCase();
  const room = message.match(/\b\d{3,4}\b/)?.[0];
  const amountMatch = message.match(/(\d+(?:\.\d+)?)\s*(万|w|W)?/);
  const amount = amountMatch ? Number(amountMatch[1]) * (amountMatch[2] ? 10000 : 1) : undefined;

  // Greeting / general
  if (/你能做|帮.*做|怎么用|解释|介绍|功能|aide|help|que faire|comment|explique/i.test(message)) {
    return {
      intent: "general_chat",
      reply: locale === "zh"
        ? "我是 SACIS 后台助理。你可以问我：\n• \"602现在什么状态？\"\n• \"今天有哪些房间要退房？\"\n• \"1106完成清洁\"\n• \"103收到租金195万\"\n• \"哪些房间需要清洁？\"\n\n我先生成操作草稿，你确认后才会写入数据库。"
        : "Je suis l'assistant SACIS. Vous pouvez me demander :\n• \"Statut 602 ?\"\n• \"Quelles chambres doivent être nettoyées ?\"\n• \"1106 ménage terminé\"\n• \"103 a reçu 1 950 000\"\n\nJe prépare des brouillons que vous confirmez avant exécution.",
      requiresConfirmation: false,
    };
  }

  // Cleaning
  if (/清洁|保洁|ménage|menage|cleaning/i.test(message) && /完成|done|termine|terminé|fait/i.test(lowered) && room) {
    return {
      intent: "business_draft", reply: `准备标记房间 ${room} 保洁已完成。`, draft: { action: "complete_cleaning", room, date: today() }, requiresConfirmation: true,
    };
  }

  // Payment
  if (/收|租金|押金|付款|payment|paiement|loyer/i.test(message) && amount && room) {
    const amt = amount >= 10000 ? `${amount / 10000}万` : String(amount);
    return {
      intent: "business_draft", reply: `准备为房间 ${room} 记录收款 ${amt} XOF。`, draft: { action: "record_payment", room, amount_xof: amount, date: today() }, requiresConfirmation: true,
    };
  }

  // Check-in / check-out
  if (/入住|check.?in|arriv/i.test(lowered) && room) {
    return { intent: "business_draft", reply: `准备为房间 ${room} 办理入住。`, draft: { action: "check_in", room, date: today() }, requiresConfirmation: true };
  }
  if (/退房|check.?out|départ|depart/i.test(lowered) && room) {
    return { intent: "business_draft", reply: `准备为房间 ${room} 办理退房。`, draft: { action: "check_out", room, date: today() }, requiresConfirmation: true };
  }

  // Leased / sold
  if (/长租|leased|loué/i.test(message) && room) {
    return { intent: "unknown", reply: `房间 ${room} 的长租状态需要在长租合同页面确认。我暂时不能直接标记长租状态。`, requiresConfirmation: false };
  }
  if (/出售|sold|vendu/i.test(message) && room) {
    return { intent: "unknown", reply: `房间 ${room} 的出售状态需要在出售合同页面确认。我暂时不能直接标记出售状态。`, requiresConfirmation: false };
  }

  // Room query
  if (room) {
    return { intent: "business_query", reply: `正在查询房间 ${room} 的信息……`, requiresConfirmation: false };
  }

  // Analytics / general busy check
  if (/今天|退房|清洁|重点|关注|quoi|aujourd|today/i.test(message)) {
    return {
      intent: "analytics",
      reply: locale === "zh"
        ? "建议你打开经营驾驶舱 (/management) 查看今日概览，或打开日租页面 (/daily-rentals) 查看今日退房和清洁任务。"
        : "Consultez le tableau de bord (/management) ou la page journalière (/daily-rentals).",
      requiresConfirmation: false,
    };
  }

  return { intent: "unknown", reply: locale === "zh" ? "我没有完全理解你的意思。可以换个说法试试？" : "Je n'ai pas bien compris. Pouvez-vous reformuler ?", requiresConfirmation: false };
}

// ═══════════════════════════════════════════════
// Business query: room context lookup
// ═══════════════════════════════════════════════

async function getRoomContext(room: string) {
  const supabase = await createClient();
  const { data: unit } = await supabase.from("units").select("id, unit_no, status, floor_label, notes").eq("unit_no", room).maybeSingle();
  if (!unit) return null;

  const [{ data: lease }, { data: sale }, { data: daily }, { data: cleaning }] = await Promise.all([
    supabase.from("lease_contracts").select("id, contract_no, start_date, expected_end_date, monthly_rent_xof, status, customer_id").eq("unit_id", unit.id).eq("status", "active").maybeSingle(),
    supabase.from("sale_contracts").select("id, contract_no, signed_date, total_amount_xof, status, customer_id").eq("unit_id", unit.id).eq("status", "active").maybeSingle(),
    supabase.from("daily_bookings").select("id, check_in, check_out, status, customer_id, total_amount_xof").eq("unit_id", unit.id).in("status", ["checked_in", "confirmed", "pending_review"]).order("check_in", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("cleaning_tasks").select("id, is_completed, completed_at").eq("unit_id", unit.id).eq("is_completed", false).limit(1).maybeSingle(),
  ]);

  const customerId = lease?.customer_id ?? sale?.customer_id ?? daily?.customer_id;
  const { data: customer } = customerId ? await supabase.from("customers").select("id, name, phone").eq("id", customerId).maybeSingle() : { data: null };

  return { unit, lease, sale, daily, customer, cleaning };
}

function roomContextReply(ctx: NonNullable<Awaited<ReturnType<typeof getRoomContext>>>, locale: string): string {
  const isZh = locale === "zh";
  const lines: string[] = [];
  lines.push(isZh ? `**房间 ${ctx.unit.unit_no}** ｜ 状态：${ctx.unit.status} ｜ 楼层：${ctx.unit.floor_label}` : `**Chambre ${ctx.unit.unit_no}** | Statut: ${ctx.unit.status} | Étage: ${ctx.unit.floor_label}`);
  if (ctx.customer) lines.push(isZh ? `当前客户：${ctx.customer.name}${ctx.customer.phone ? ` (${ctx.customer.phone})` : ""}` : `Client: ${ctx.customer.name}${ctx.customer.phone ? ` (${ctx.customer.phone})` : ""}`);
  if (ctx.lease) lines.push(isZh ? `长租：${ctx.lease.contract_no}，${ctx.lease.start_date} → ${ctx.lease.expected_end_date}，月租 ${formatXof(Number(ctx.lease.monthly_rent_xof))}` : `Bail: ${ctx.lease.contract_no}, ${ctx.lease.start_date} → ${ctx.lease.expected_end_date}, ${formatXof(Number(ctx.lease.monthly_rent_xof))}/mois`);
  if (ctx.sale) lines.push(isZh ? `出售：${ctx.sale.contract_no}，总额 ${formatXof(Number(ctx.sale.total_amount_xof))}` : `Vente: ${ctx.sale.contract_no}, ${formatXof(Number(ctx.sale.total_amount_xof))}`);
  if (ctx.daily) lines.push(isZh ? `日租：${ctx.daily.check_in} → ${ctx.daily.check_out ?? "未定"}，${ctx.daily.status}，总额 ${formatXof(Number(ctx.daily.total_amount_xof))}` : `Journalier: ${ctx.daily.check_in} → ${ctx.daily.check_out ?? "ouvert"}, ${ctx.daily.status}, ${formatXof(Number(ctx.daily.total_amount_xof))}`);
  if (ctx.cleaning) lines.push(isZh ? "⚠ 有待完成清洁任务" : "⚠ Ménage en attente");
  if (ctx.unit.notes) lines.push(isZh ? `备注：${ctx.unit.notes}` : `Note: ${ctx.unit.notes}`);
  return lines.join("\n");
}

async function todaySummary(locale: string): Promise<string> {
  const supabase = await createClient();
  const isZh = locale === "zh";
  const t = today();
  const [{ count: cleaningCount }, { count: checkoutCount }] = await Promise.all([
    supabase.from("cleaning_tasks").select("*", { count: "exact", head: true }).eq("is_completed", false),
    supabase.from("daily_bookings").select("*", { count: "exact", head: true }).eq("status", "checked_in"),
  ]);
  return isZh
    ? `**今日概览**\n• 当前入住：${checkoutCount ?? "?"} 间\n• 待清洁：${cleaningCount ?? "?"} 间\n• 建议查看日租页面确认具体退房和清洁任务。`
    : `**Aperçu du jour**\n• Occupés: ${checkoutCount ?? "?"} chambres\n• Ménage en attente: ${cleaningCount ?? "?"}\n• Consultez la page journalière pour les détails.`;
}

// ═══════════════════════════════════════════════
// POST
// ═══════════════════════════════════════════════

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = await req.json();
    const message = String(body.message ?? "").trim();
    const locale = String(body.locale ?? "zh");
    if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

    const apiKey = process.env.DEEPSEEK_API_KEY;
    let result: AssistantResult;

    if (apiKey) {
      const systemMsg = buildSystemPrompt(locale);
      const aiResponse = await chatWithDeepSeek([
        { role: "system", content: systemMsg },
        { role: "user", content: message },
      ]);

      if (aiResponse) {
        const parsed = extractJson(aiResponse);
        const intent = (parsed.intent as AssistantIntent) ?? "unknown";
        result = {
          reply: (parsed.reply as string) ?? aiResponse,
          intent,
          draft: (parsed.draft as Record<string, unknown> | null) ?? null,
          requiresConfirmation: parsed.requiresConfirmation === true,
        };
      } else {
        result = fallbackChat(message, locale);
      }
    } else {
      result = fallbackChat(message, locale);
    }

    // Enrich business_query with actual room data
    if (result.intent === "business_query" || (result.intent === "unknown" && /\b\d{3,4}\b/.test(message))) {
      const room = message.match(/\b\d{3,4}\b/)?.[0];
      if (room) {
        const ctx = await getRoomContext(room);
        if (ctx) {
          result.reply = roomContextReply(ctx, locale);
          result.intent = "business_query";
        }
      }
    }

    // Enrich analytics with today's numbers
    if (result.intent === "analytics" && /今天|今日|概览|aujourd|today|résumé|aperçu/i.test(message)) {
      result.reply = await todaySummary(locale);
    }

    const isWrite = result.intent === "business_draft";
    const canWrite = !isWrite || hasPermission(user, "daily_rentals:write") || hasPermission(user, "finance:write");

    return NextResponse.json({
      reply: canWrite ? result.reply : "你当前账号没有执行此类操作的权限。",
      intent: result.intent,
      draft: result.draft ?? null,
      requiresConfirmation: result.requiresConfirmation ?? false,
      executable: false,
    });
  } catch (error) {
    console.error("assistant error", error);
    return NextResponse.json({ error: "Assistant failed", reply: "AI助手暂时不可用，请稍后重试。" }, { status: 500 });
  }
}
