import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { buildAssistantContext, buildContextPrompt, type AssistantContext } from "../context";

type AssistantIntent = "general_chat" | "business_query" | "business_draft" | "analytics" | "unknown";

interface AssistantResult {
  reply: string;
  intent: AssistantIntent;
  draft?: Record<string, unknown> | null;
  requiresConfirmation?: boolean;
  usedContext?: string[];
  error?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

// ═══════════════════════════════════════════════
// DeepSeek
// ═══════════════════════════════════════════════

async function chatWithDeepSeek(messages: { role: string; content: string }[]): Promise<string | null> {
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
// System prompt with injected context
// ═══════════════════════════════════════════════

function buildSystemPrompt(locale: string, contextPrompt: string): string {
  return [
    "You are SACIS Assistant, a back-office operations AI for a property management system in Abidjan, Côte d'Ivoire.",
    "You help staff manage daily rentals, leases, sales, finance, cleaning, and customers.",
    "",
    contextPrompt,
    "",
    "--- YOUR TASK ---",
    "First, classify the user message into one of these intents:",
    "- general_chat: casual questions, how-to, system explanation, \"what can you do\"",
    "- business_query: asking about room status, customer info, today's tasks, cleaning, occupancy",
    "- business_draft: requesting an action like check-in, check-out, record payment, complete cleaning",
    "- analytics: asking about statistics, trends, summaries across rooms/buildings",
    "- unknown: cannot determine intent",
    "",
    "Reply in JSON format:",
    "{",
    "  \"intent\": \"<intent>\",",
    "  \"reply\": \"<natural-language reply in " + (locale === "fr" ? "French" : "Chinese") + ">\",",
    "  \"draft\": null or { \"action\": \"...\", \"room\": \"...\", \"amount_xof\": number, ... },",
    "  \"requiresConfirmation\": true or false,",
    "  \"usedContext\": [\"daily_summary\", \"room\", \"finance\"]",
    "}",
    "",
    "CRITICAL RULES:",
    "- ONLY use data from the BUSINESS CONTEXT above. Do NOT invent or guess data.",
    "- If the context doesn't contain enough data to answer, say so clearly.",
    "- For general_chat: draft=null, requiresConfirmation=false. Reply naturally.",
    "- For business_query: reference specific numbers from the context. draft=null.",
    "- For business_draft: set draft with action/room/amount from context. requiresConfirmation=true. NEVER claim you've executed it.",
    "- When the context has DAILY SUMMARY, use those numbers to answer \"how is today\" questions.",
    "- Room numbers are 3-4 digits like 602, 1106.",
    "- Amounts are in XOF (West African CFA franc).",
    "",
    "SYSTEM CAPABILITIES (what you CAN do):",
    "- Query room status (business_query)",
    "- Generate drafts for: check-in, check-out, record payment, complete cleaning (business_draft)",
    "- Show today's occupancy, cleaning, payments summary (analytics)",
    "- Answer business questions using provided context data",
    "",
    "SYSTEM LIMITATIONS (what you CANNOT do):",
    "- The system has NO timed/scheduled check-in. All check-ins are full-day, date-level only.",
    "- There is NO reservation system for specific hours (e.g., 'check in at 11 PM').",
    "- You cannot create, modify, or cancel bookings — only generate draft suggestions.",
    "- You cannot manually change unit status or clean status.",
    "- You cannot process refunds or complex multi-step financial operations.",
    "",
    "IMPORTANT — Scenario vs Command:",
    "- If the user DESCRIBES a situation (e.g., 'a guest wants to check in at 11 PM', 'someone asked if they can arrive late'),",
    "  this is general_chat or business_query, NOT business_draft.",
    "- If the user mentions specific times ('几点', '几点入住', '晚上', '下午', '早上'),",
    "  this is a question about system capabilities, not a check-in command.",
    "- Only generate a draft when the user CLEARLY commands an action, e.g.:",
    "  '602办理入住', '1106完成清洁', '103收到租金195万'.",
    "- Ambiguous messages like '1202有客人要入住' should be business_query — first check the room status, then ask if the user wants a draft.",
    "- Messages containing both a room number AND question words ('为什么', '能不能', '可以吗', '怎么', '几点') are questions, NOT commands.",
  ].join("\n");
}

// ═══════════════════════════════════════════════
// Fallback (no API key) — uses context
// ═══════════════════════════════════════════════

function fallbackChat(message: string, ctx: AssistantContext, locale: string): AssistantResult {
  const zh = locale === "zh";
  const lowered = message.toLowerCase();
  const roomNums = [...message.matchAll(/\b(\d{3,4})\b/g)].map(r => r[1]);
  const amountMatch = message.match(/(\d+(?:\.\d+)?)\s*(万|w|W)?/);
  const amount = amountMatch ? Number(amountMatch[1]) * (amountMatch[2] ? 10000 : 1) : undefined;

  // ── Help / capabilities ──
  if (/你能做|帮.*做|怎么用|解释|介绍|功能|aide|help|que faire|comment|explique/i.test(message)) {
    return {
      intent: "general_chat",
      reply: zh
        ? `我是 SACIS 后台助理。当前项目是 ${ctx.project}。\n\n你可以问我：\n• "今天情况怎么样？"\n• "602现在什么状态？"\n• "1106完成清洁"\n• "103收到租金195万"\n• "哪些房间需要清洁？"\n\n我先生成操作草稿，你确认后才会写入数据库。`
        : `Je suis l'assistant SACIS (${ctx.project}).\n\nDemandez-moi :\n• "Aperçu du jour ?"\n• "Statut 602 ?"\n• "1106 ménage terminé"\n• "Paiement 1 950 000 pour 103"\n\nJe prépare des brouillons, vous confirmez.`,
      requiresConfirmation: false,
    };
  }

  // ── Daily overview ──
  const wantsDaily = /今天|今日|概览|情况|重点|关注|退房|清洁|日租|aujourd|today|résumé|aperçu|overview/i.test(message);
  if (wantsDaily && ctx.dailySummary) {
    const ds = ctx.dailySummary;
    const lines = [
      zh ? `**今日概览 (${ctx.date})**` : `**Aperçu du jour (${ctx.date})**`,
      zh ? `当前入住：${ds.checkedInCount} 间` : `Occupés : ${ds.checkedInCount} chambres`,
      zh ? `待清洁：${ds.cleaningPendingCount} 间` : `Ménage en attente : ${ds.cleaningPendingCount}`,
      zh ? `今日已完成清洁：${ds.cleaningDoneToday} 间` : `Ménage terminé aujourd'hui : ${ds.cleaningDoneToday}`,
      zh ? `今日新增预订：${ds.newBookingsToday} 单` : `Nouvelles réservations : ${ds.newBookingsToday}`,
      zh ? `今日收款：${ds.todayPayments.count} 笔，共 ${ds.todayPayments.total.toLocaleString()} XOF` : `Paiements du jour : ${ds.todayPayments.count}, total ${ds.todayPayments.total.toLocaleString()} XOF`,
      zh ? `本月收款：${ds.monthPayments.count} 笔，共 ${ds.monthPayments.total.toLocaleString()} XOF` : `Paiements du mois : ${ds.monthPayments.count}, total ${ds.monthPayments.total.toLocaleString()} XOF`,
    ];
    return { intent: "analytics", reply: lines.join("\n"), requiresConfirmation: false, usedContext: ["daily_summary"] };
  }
  if (wantsDaily && !ctx.dailySummary) {
    return { intent: "analytics", reply: zh ? "后台暂无今日数据。请检查日租页面。" : "Pas de données aujourd'hui. Vérifiez la page journalière.", requiresConfirmation: false };
  }

  // ── Room query ──
  if (roomNums.length > 0 && ctx.rooms) {
    const results: string[] = [];
    for (const roomNo of roomNums) {
      const room = ctx.rooms[roomNo];
      if (!room) { results.push(zh ? `**房间 ${roomNo}**：未找到` : `**Chambre ${roomNo}** : introuvable`); continue; }
      const u = room.unit as Record<string, unknown> | null;
      if (!u) { results.push(zh ? `**房间 ${roomNo}**：未找到` : `**Chambre ${roomNo}** : introuvable`); continue; }
      const lines = [zh ? `**房间 ${u.unit_no}** ｜ 状态：${u.status} ｜ 楼层：${u.floor_label}` : `**Chambre ${u.unit_no}** | Statut: ${u.status} | Étage: ${u.floor_label}`];
      if (room.customer) { const c = room.customer as Record<string, unknown>; lines.push(zh ? `当前客户：${c.name}${c.phone ? ` (${c.phone})` : ""}` : `Client: ${c.name}${c.phone ? ` (${c.phone})` : ""}`); }
      if (room.lease) { const l = room.lease as Record<string, unknown>; lines.push(zh ? `长租：${l.contract_no}，${l.start_date}→${l.expected_end_date}，月租 ${Number(l.monthly_rent_xof).toLocaleString()} XOF` : `Bail: ${l.contract_no}, ${l.start_date}→${l.expected_end_date}, ${Number(l.monthly_rent_xof).toLocaleString()} XOF/mois`); }
      if (room.sale) { const s = room.sale as Record<string, unknown>; lines.push(zh ? `出售：${s.contract_no}，总额 ${Number(s.total_amount_xof).toLocaleString()} XOF` : `Vente: ${s.contract_no}, ${Number(s.total_amount_xof).toLocaleString()} XOF`); }
      if (room.daily) { const d = room.daily as Record<string, unknown>; lines.push(zh ? `日租：${d.check_in}→${d.check_out ?? "未定"}，${d.status}，总额 ${Number(d.total_amount_xof).toLocaleString()} XOF` : `Journalier: ${d.check_in}→${d.check_out ?? "ouvert"}, ${d.status}, ${Number(d.total_amount_xof).toLocaleString()} XOF`); }
      if (room.cleaning) lines.push(zh ? "⚠ 有待完成清洁任务" : "⚠ Ménage en attente");
      if (room.payments && (room.payments as unknown[]).length > 0) {
        const pms = room.payments as Record<string, unknown>[];
        const total = pms.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        lines.push(zh ? `总收款：${total.toLocaleString()} XOF` : `Total paiements: ${total.toLocaleString()} XOF`);
      }
      results.push(lines.join("\n"));
    }
    return { intent: "business_query", reply: results.join("\n\n"), requiresConfirmation: false, usedContext: ["room"] };
  }

  // ── Draft commands (only when user CLEARLY issues a command, not describing a scenario) ──
  const isScenarioOrQuestion = /预定|预约|几点|什么时候|今晚|明天|可以.*吗|能不能|怎么.*做|怎样.*做|为什么|réservation|réserver|quelle heure|quand|peut.*on|pourquoi/i.test(message);
  if (/清洁|保洁|ménage|menage|cleaning/i.test(message) && /完成|done|termine|terminé|fait/i.test(lowered) && roomNums.length > 0 && !isScenarioOrQuestion) {
    return { intent: "business_draft", reply: `准备标记房间 ${roomNums[0]} 保洁已完成。`, draft: { action: "complete_cleaning", room: roomNums[0], date: today() }, requiresConfirmation: true };
  }
  if (/收|租金|押金|付款|payment|paiement|loyer/i.test(message) && amount && roomNums.length > 0 && !isScenarioOrQuestion) {
    return { intent: "business_draft", reply: `准备为房间 ${roomNums[0]} 记录收款 ${amount.toLocaleString()} XOF。`, draft: { action: "record_payment", room: roomNums[0], amount_xof: amount, date: today() }, requiresConfirmation: true };
  }
  if (/入住|check.?in|arriv/i.test(lowered) && roomNums.length > 0 && !isScenarioOrQuestion) {
    return { intent: "business_draft", reply: `准备为房间 ${roomNums[0]} 办理入住。`, draft: { action: "check_in", room: roomNums[0], date: today() }, requiresConfirmation: true };
  }
  if (/退房|check.?out|départ|depart/i.test(lowered) && roomNums.length > 0 && !isScenarioOrQuestion) {
    return { intent: "business_draft", reply: `准备为房间 ${roomNums[0]} 办理退房。`, draft: { action: "check_out", room: roomNums[0], date: today() }, requiresConfirmation: true };
  }

  // Scenario description with room number → business_query, not draft
  if (roomNums.length > 0 && isScenarioOrQuestion && /入住|check.?in|arriv|退房|check.?out|清洁|保洁|支付|付|收租/i.test(message)) {
    return {
      intent: "business_query",
      reply: zh
        ? `我听出来你在描述一个场景，不是直接命令。\n\n关于房间 ${roomNums.join("、")}：系统目前只支持全天级别的入住/退房操作，不支持按小时预约（如"今晚十一点入住"）。如果需要办理入住，请直接说"${roomNums[0]}办理入住"，我会生成草稿。\n\n需要我帮你查一下 ${roomNums.join("、")} 的当前状态吗？`
        : `Je comprends que vous décrivez un scénario, pas une commande.\n\nConcernant la chambre ${roomNums.join(", ")} : le système ne gère que les check-ins par date, pas par horaire spécifique. Pour un check-in, dites "${roomNums[0]}办理入住".\n\nVoulez-vous que je vérifie le statut de ${roomNums.join(", ")} ?`,
      requiresConfirmation: false,
    };
  }

  return { intent: "unknown", reply: zh ? "我没有完全理解你的意思。可以换个说法试试？" : "Je n'ai pas bien compris. Pouvez-vous reformuler ?", requiresConfirmation: false };
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

    // ── Load business context ──
    const ctx = await buildAssistantContext(message, user, locale);

    const apiKey = process.env.DEEPSEEK_API_KEY;
    let result: AssistantResult;

    if (apiKey) {
      const contextPrompt = buildContextPrompt(ctx, locale);
      const systemMsg = buildSystemPrompt(locale, contextPrompt);
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
          usedContext: (parsed.usedContext as string[]) ?? undefined,
        };
      } else {
        result = fallbackChat(message, ctx, locale);
      }
    } else {
      result = fallbackChat(message, ctx, locale);
    }

    const isWrite = result.intent === "business_draft";
    const canWrite = !isWrite || hasPermission(user, "daily_rentals:write") || hasPermission(user, "finance:write");

    return NextResponse.json({
      reply: canWrite ? result.reply : "你当前账号没有执行此类操作的权限。",
      intent: result.intent,
      draft: result.draft ?? null,
      requiresConfirmation: result.requiresConfirmation ?? false,
      executable: false,
      usedContext: result.usedContext ?? [],
    });
  } catch (error) {
    console.error("assistant error", error);
    return NextResponse.json({ error: "Assistant failed", reply: "AI助手暂时不可用，请稍后重试。" }, { status: 500 });
  }
}
