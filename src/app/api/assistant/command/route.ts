import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { buildAssistantContext, buildContextPrompt, type AssistantContext } from "../context";

type AssistantIntent = "general_chat" | "business_query" | "business_draft" | "analytics" | "unknown";

interface HistoryEntry { role: "user" | "assistant"; content: string; }

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
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? null;
}

function extractJson(text: string): Record<string, unknown> {
  // Try fenced code block first
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]) as Record<string, unknown>; } catch { /* fall through */ }
  }
  // Try raw JSON object
  const raw = text.match(/\{[\s\S]*\}/);
  if (raw) {
    try { return JSON.parse(raw[0]) as Record<string, unknown>; } catch { /* fall through */ }
  }
  // Fallback: return the raw text as reply — don't show broken JSON
  return { intent: "unknown", reply: text.slice(0, 500), draft: null };
}

// ═══════════════════════════════════════════════
// System prompt
// ═══════════════════════════════════════════════

function buildSystemPrompt(locale: string, contextPrompt: string): string {
  return [
    "You are SACIS Assistant, a back-office operations AI for a property management system in Abidjan, Côte d'Ivoire.",
    "You help staff manage daily rentals, leases, sales, finance, cleaning, and customers.",
    "",
    contextPrompt,
    "",
    "--- YOUR TASK ---",
    "Classify the user message into: general_chat, business_query, business_draft, analytics, unknown.",
    "",
    "Reply in strict JSON format (no markdown, no code fences — pure JSON):",
    "{",
    "  \"intent\": \"<intent>\",",
    "  \"reply\": \"<natural-language reply in " + (locale === "fr" ? "French" : "Chinese") + ">\",",
    "  \"draft\": null or { \"action\": \"...\", \"room\": \"...\", \"amount_xof\": number, ... },",
    "  \"requiresConfirmation\": true or false,",
    "  \"usedContext\": [\"daily_summary\", \"room\", \"finance\", \"audit\"]",
    "}",
    "",
    "CRITICAL RULES:",
    "- ONLY use data from the BUSINESS CONTEXT. Do NOT invent data.",
    "- If data is insufficient, say so clearly.",
    "- business_draft: draft with action/room/amount, requiresConfirmation=true, NEVER claim you executed it.",
    "- Reference RECENT AUDIT LOGS when the user asks about recent operations.",
    "- Reference PAYMENTS details (source_type, amount, payment_date) in your answers.",
    "",
    "SYSTEM LIMITATIONS:",
    "- NO timed/scheduled check-in. Check-ins are always full-day.",
    "- NO reservation system. Cannot reserve specific hours.",
    "- CANNOT modify bookings — only generate draft suggestions.",
    "- CANNOT process refunds.",
    "",
    "SCENARIO vs COMMAND:",
    "- \"a guest wants to check in at 11 PM\" → general_chat (scenario, not command)",
    "- Messages with time references (几点, 几点入住, 晚上, 下午, 早上) are QUESTIONS, not commands.",
    "- Messages with question words (为什么, 能不能, 可以吗, 怎么) are QUESTIONS.",
  ].join("\n");
}

// ═══════════════════════════════════════════════
// Fallback
// ═══════════════════════════════════════════════

function fallbackChat(message: string, ctx: AssistantContext, locale: string): AssistantResult {
  const zh = locale === "zh";
  const lowered = message.toLowerCase();
  const explicitRoomNums = [...message.matchAll(/\b(\d{3,4})\b/g)].map(r => r[1]);
  const contextRoomNums = ctx.rooms ? Object.keys(ctx.rooms) : [];
  const roomNums = explicitRoomNums.length > 0 ? explicitRoomNums : contextRoomNums;
  const amountMatch = message.match(/(\d+(?:\.\d+)?)\s*(万|w|W)?/);
  const amount = amountMatch ? Number(amountMatch[1]) * (amountMatch[2] ? 10000 : 1) : undefined;
  const isScenarioOrQuestion = /预定|预约|几点|什么时候|今晚|明天|可以.*吗|能不能|怎么.*做|怎样.*做|为什么|réservation|réserver|quelle heure|quand|peut.*on|pourquoi/i.test(message);

  if (/你能做|帮.*做|怎么用|解释|介绍|功能|aide|help|que faire|comment|explique/i.test(message)) {
    return { intent: "general_chat", reply: zh ? `我是 SACIS 后台助理 (${ctx.project})。\n\n你可以问我：\n• "今天情况怎么样？"\n• "602现在什么状态？"\n• "1106完成清洁"\n• "103收到租金195万"\n• "今天谁操作了系统？"\n\n我先生成操作草稿，你确认后才会写入数据库。` : `Je suis l'assistant SACIS (${ctx.project}).\n\nDemandez-moi un aperçu du jour, le statut d'une chambre, ou générez des brouillons d'opération.`, requiresConfirmation: false };
  }

  // Daily overview
  if (/今天|今日|概览|情况|重点|关注|退房|清洁|日租|aujourd|today|résumé|aperçu|overview/i.test(message) && ctx.dailySummary) {
    const ds = ctx.dailySummary;
    return { intent: "analytics", reply: [
      zh ? `**今日概览 (${ctx.date})**` : `**Aperçu (${ctx.date})**`,
      zh ? `当前入住：${ds.checkedInCount} 间` : `Occupés: ${ds.checkedInCount}`,
      zh ? `待清洁：${ds.cleaningPendingCount} 间` : `Ménage: ${ds.cleaningPendingCount}`,
      zh ? `今日已完成清洁：${ds.cleaningDoneToday} 间` : `Ménage terminé: ${ds.cleaningDoneToday}`,
      zh ? `今日退房：${ds.checkoutsToday} 单` : `Départs: ${ds.checkoutsToday}`,
      zh ? `今日新预订：${ds.newBookingsToday} 单` : `Nouvelles réservations: ${ds.newBookingsToday}`,
      zh ? `今日收款：${ds.todayPayments.count} 笔，共 ${ds.todayPayments.total.toLocaleString()} XOF` : `Paiements: ${ds.todayPayments.count}, ${ds.todayPayments.total.toLocaleString()} XOF`,
      zh ? `本月收款：${ds.monthPayments.count} 笔，共 ${ds.monthPayments.total.toLocaleString()} XOF` : `Mois: ${ds.monthPayments.count}, ${ds.monthPayments.total.toLocaleString()} XOF`,
    ].join("\n"), requiresConfirmation: false, usedContext: ["daily_summary"] };
  }

  // Audit log query
  if (/审计|操作|谁.*做|谁.*改|最近.*操作|前台.*做|清洁.*谁|historique|audit|qui a/i.test(message) && ctx.globalAuditLogs) {
    const logs = ctx.globalAuditLogs;
    if (logs.length === 0) return { intent: "business_query", reply: zh ? "今天还没有操作记录。" : "Aucune opération aujourd'hui.", requiresConfirmation: false };
    const lines = [zh ? `**今日操作记录 (${logs.length} 条)**` : `**Opérations du jour (${logs.length})**`];
    for (const l of logs) {
      const meta = l.metadata as Record<string, unknown> | undefined;
      const action = l.action ?? "?";
      const when = ((l.created_at as string) ?? "").slice(11, 19);
      const room = meta?.unit_no || meta?.room || "";
      const by = meta?.operator_name || meta?.operator || "";
      const extras = meta?.amount ? ` ${Number(meta.amount).toLocaleString()}XAF` : "";
      lines.push(`${when} ${action} ${room ? `房间${room}` : ""}${by ? ` ${by}` : ""}${extras}`);
    }
    return { intent: "business_query", reply: lines.join("\n"), requiresConfirmation: false, usedContext: ["audit"] };
  }

  // Room query
  if (roomNums.length > 0 && ctx.rooms) {
    const results: string[] = [];
    for (const roomNo of roomNums) {
      const room = ctx.rooms[roomNo];
      if (!room?.unit) { results.push(zh ? `**${roomNo}**：未找到` : `**${roomNo}**: introuvable`); continue; }
      const u = room.unit as Record<string, unknown>;
      const lines = [zh ? `**${u.unit_no}** ｜ ${u.status} ｜ ${u.floor_label}` : `**${u.unit_no}** | ${u.status} | ${u.floor_label}`];
      if (room.customer) { const c = room.customer as Record<string, unknown>; lines.push(zh ? `客户：${c.name}${c.phone ? ` (${c.phone})` : ""}` : `Client: ${c.name}${c.phone ? ` (${c.phone})` : ""}`); }
      if (room.lease) { const l = room.lease as Record<string, unknown>; lines.push(zh ? `长租：${l.contract_no}，${l.start_date}→${l.expected_end_date}，${Number(l.monthly_rent_xof).toLocaleString()} XOF/月` : `Bail: ${l.contract_no}, ${l.start_date}→${l.expected_end_date}`); }
      if (room.sale) { const s = room.sale as Record<string, unknown>; lines.push(zh ? `出售：${s.contract_no}，${Number(s.total_amount_xof).toLocaleString()} XOF` : `Vente: ${s.contract_no}`); }
      if (room.daily) { const d = room.daily as Record<string, unknown>; lines.push(zh ? `日租：${d.check_in}→${d.check_out ?? "未定"}，${d.status}` : `Journalier: ${d.check_in}→${d.check_out ?? "ouvert"}, ${d.status}`); }
      if (room.cleaning) lines.push(zh ? "⚠ 待保洁" : "⚠ Ménage en attente");
      if (room.payments && (room.payments as unknown[]).length > 0) {
        const pms = room.payments as Record<string, unknown>[];
        const total = pms.reduce((s, p) => s + Number(p.amount || 0) * (Number(p.exchange_rate_to_xof) || 1), 0);
        lines.push(zh ? `收款 ${pms.length} 笔，共 ${total.toLocaleString()} XOF` : `Paiements: ${pms.length}, ${total.toLocaleString()} XOF`);
      }
      results.push(lines.join("\n"));
    }
    return { intent: "business_query", reply: results.join("\n\n"), requiresConfirmation: false, usedContext: ["room"] };
  }

  // Draft commands (only when NOT a scenario/question)
  if (!isScenarioOrQuestion) {
    if (/清洁|保洁|ménage|menage|cleaning/i.test(message) && /完成|done|termine|terminé|fait/i.test(lowered) && roomNums.length > 0) {
      return { intent: "business_draft", reply: `准备标记房间 ${roomNums[0]} 保洁已完成。`, draft: { action: "complete_cleaning", room: roomNums[0], date: today() }, requiresConfirmation: true };
    }
    if (/收|租金|押金|付款|payment|paiement|loyer/i.test(message) && amount && roomNums.length > 0) {
      return { intent: "business_draft", reply: `准备为房间 ${roomNums[0]} 记录收款 ${amount.toLocaleString()} XOF。`, draft: { action: "record_payment", room: roomNums[0], amount_xof: amount, date: today() }, requiresConfirmation: true };
    }
    if (/入住|check.?in|arriv/i.test(lowered) && roomNums.length > 0) {
      return { intent: "business_draft", reply: `准备为房间 ${roomNums[0]} 办理入住。`, draft: { action: "check_in", room: roomNums[0], date: today() }, requiresConfirmation: true };
    }
    if (/退房|check.?out|départ|depart/i.test(lowered) && roomNums.length > 0) {
      return { intent: "business_draft", reply: `准备为房间 ${roomNums[0]} 办理退房。`, draft: { action: "check_out", room: roomNums[0], date: today() }, requiresConfirmation: true };
    }
  }

  // Scenario → explain limitation
  if (roomNums.length > 0 && isScenarioOrQuestion) {
    return { intent: "business_query", reply: zh ? `我听出来你在描述一个场景。\n\n关于房间 ${roomNums.join("、")}：系统只支持全天级别的入住/退房，不支持按小时预约。如果需要办理入住，请直接说"${roomNums[0]}办理入住"。\n\n需要我查一下 ${roomNums.join("、")} 的当前状态吗？` : `Je comprends que vous décrivez un scénario.\n\nLe système ne gère que les check-ins par date. Dites "${roomNums[0]}办理入住" pour un check-in.\n\nVoulez-vous que je vérifie le statut ?`, requiresConfirmation: false };
  }

  return { intent: "unknown", reply: zh ? "我没有完全理解。可以换个说法试试？" : "Je n'ai pas bien compris. Reformulez ?", requiresConfirmation: false };
}

// ═══════════════════════════════════════════════
// Permission per draft action
// ═══════════════════════════════════════════════

function canExecuteDraft(
  user: { role?: string | null; id?: string; displayName?: string | null },
  draft: Record<string, unknown>,
): boolean {
  const action = draft.action as string ?? "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = user as any;
  switch (action) {
    case "record_payment": return hasPermission(u, "finance:write");
    case "complete_cleaning": return hasPermission(u, "daily_rentals:write");
    case "check_in": case "check_out": return hasPermission(u, "daily_rentals:write");
    default: return false; // P2: unknown actions must be explicitly whitelisted
  }
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
    const history = (body.history ?? []) as HistoryEntry[];
    if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

    // Load business context (with history for follow-up tracking)
    const ctx = await buildAssistantContext(message, user, locale, history);

    const apiKey = process.env.DEEPSEEK_API_KEY;
    let result: AssistantResult;

    if (apiKey) {
      const contextPrompt = buildContextPrompt(ctx, locale);
      const systemMsg = buildSystemPrompt(locale, contextPrompt);

      // Build messages array: system + trimmed history + current message
      const messages: { role: string; content: string }[] = [
        { role: "system", content: systemMsg },
      ];
      const recentHistory = history.slice(-10);
      for (const h of recentHistory) {
        if (h.role === "user") messages.push({ role: "user", content: h.content });
        else if (h.role === "assistant") messages.push({ role: "assistant", content: h.content });
      }
      messages.push({ role: "user", content: message });

      const aiResponse = await chatWithDeepSeek(messages);

      if (aiResponse) {
        const parsed = extractJson(aiResponse);
        const intent = (parsed.intent as AssistantIntent) ?? "unknown";
        const reply = (parsed.reply as string) ?? aiResponse;
        result = {
          reply: reply.length > 0 ? reply : aiResponse,
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
    const canWrite = !isWrite || (result.draft ? canExecuteDraft(user, result.draft as Record<string, unknown>) : false);

    return NextResponse.json({
      reply: canWrite ? result.reply : "你当前账号没有执行此类操作的权限。",
      intent: result.intent,
      draft: result.draft ?? null,
      requiresConfirmation: canWrite && (result.requiresConfirmation ?? false),
      executable: false,
      usedContext: result.usedContext ?? [],
    });
  } catch (error) {
    console.error("assistant error", error);
    return NextResponse.json({ error: "Assistant failed", reply: "AI助手暂时不可用，请稍后重试。" }, { status: 500 });
  }
}
