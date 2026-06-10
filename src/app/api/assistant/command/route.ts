import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import {
  buildAssistantContext,
  buildContextPrompt,
  type AssistantContext,
  type AssistantDraft,
  type AssistantIntent,
  type HistoryEntry,
} from "../context";

interface AssistantResult {
  reply: string;
  intent: AssistantIntent;
  draft?: AssistantDraft | null;
  requiresConfirmation?: boolean;
  usedContext?: string[];
  error?: string;
}

type Locale = "zh" | "fr";
const DETERMINISTIC_INTENTS = new Set<AssistantIntent>([
  "daily_today_overview",
  "daily_today_checkouts",
  "daily_today_checkins",
  "daily_cleaning_tasks",
  "daily_available_rooms",
  "room_profile",
  "finance_receivables",
  "audit_activity",
  "business_draft",
]);

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
      temperature: 0.25,
      messages,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? null;
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]) as Record<string, unknown>; } catch {}
  }
  const raw = text.match(/\{[\s\S]*\}/);
  if (raw) {
    try { return JSON.parse(raw[0]) as Record<string, unknown>; } catch {}
  }
  return { reply: text.slice(0, 1000) };
}

function buildSystemPrompt(locale: Locale, contextPrompt: string): string {
  const language = locale === "fr" ? "French" : "Chinese";
  return [
    "You are SACIS Assistant, a conversational back-office operations assistant for a property management system in Abidjan.",
    "You should feel like a capable colleague: understand the user's real intent, answer naturally, and avoid rigid report-template language unless the user asks for a report.",
    "",
    "Your job is not to invent business facts. The application has already selected business tools and placed their results in TOOL_CONTEXT.",
    "Room numbers, customer names, dates, amounts, statuses, receipt numbers, audit actors, and task IDs must come only from TOOL_CONTEXT.",
    "If TOOL_CONTEXT does not contain a fact, say that it is not available from current data.",
    "For write-like requests, return a draft only. Never say that an operation has been executed.",
    "",
    contextPrompt,
    "",
    "Return strict JSON only:",
    "{",
    '  "reply": "natural answer in ' + language + '",',
    '  "intent": "same intent as TOOL_CONTEXT.intent",',
    '  "draft": null or the draft object from TOOL_CONTEXT,',
    '  "requiresConfirmation": true or false,',
    '  "usedContext": ["tool name or data area"]',
    "}",
  ].join("\n");
}

const money = (value: unknown) => `${Number(value || 0).toLocaleString()} XOF`;

function formatActor(log: Record<string, unknown>) {
  return log.actor_display_name || log.actor_email || log.actor_role || "未知操作人";
}

function fallbackReply(ctx: AssistantContext, locale: Locale): AssistantResult {
  const zh = locale === "zh";
  const tool = ctx.toolContext as Record<string, unknown>;
  const data = (tool.data ?? tool) as Record<string, unknown>;
  const toolWarnings = [
    ...((tool.warnings ?? []) as string[]),
    ...(((tool.missingFields as string[] | undefined)?.length ?? 0) > 0
      ? [zh ? `工具结果缺少字段：${((tool.missingFields ?? []) as string[]).join("、")}` : `Champs manquants : ${((tool.missingFields ?? []) as string[]).join(", ")}`]
      : []),
  ];
  const withWarnings = (reply: string) => toolWarnings.length > 0 ? `${reply}\n${zh ? "注意：" : "Attention :"}${toolWarnings.join("；")}` : reply;

  if (ctx.intent === "general_chat") {
    return {
      intent: ctx.intent,
      reply: withWarnings(zh
        ? "我可以像后台业务助理一样帮你查日租退房、入住、清洁、房间档案、收款和审计日志。涉及修改时，我会先生成草稿，等你确认后才应该写入数据库。"
        : "Je peux vérifier les départs, arrivées, ménages, chambres, paiements et journaux d'audit. Pour les modifications, je prépare d'abord un brouillon à confirmer."),
      requiresConfirmation: false,
      usedContext: ["none"],
    };
  }

  if (ctx.intent === "daily_today_overview") {
    const checkouts = (data.checkouts ?? []) as Record<string, unknown>[];
    const checkins = (data.checkins ?? []) as Record<string, unknown>[];
    const cleaningTasks = (data.cleaningTasks ?? []) as Record<string, unknown>[];
    const availableRooms = (data.availableRooms ?? []) as Record<string, unknown>[];
    const pendingCleaning = cleaningTasks.filter((task) => task.is_completed === false);
    const lines = [
      zh ? `今天日租运营：退房 ${checkouts.length} 间，入住 ${checkins.length} 间，待清洁 ${pendingCleaning.length} 间，可入住 ${availableRooms.length} 间。`
        : `Aujourd'hui : ${checkouts.length} départ(s), ${checkins.length} arrivée(s), ${pendingCleaning.length} ménage(s), ${availableRooms.length} disponible(s).`,
    ];
    if (checkouts.length > 0) lines.push(zh ? `退房：${checkouts.map((item) => item.room_no ?? "?").join("、")}` : `Départs : ${checkouts.map((item) => item.room_no ?? "?").join(", ")}`);
    if (checkins.length > 0) lines.push(zh ? `入住：${checkins.map((item) => item.room_no ?? "?").join("、")}` : `Arrivées : ${checkins.map((item) => item.room_no ?? "?").join(", ")}`);
    if (pendingCleaning.length > 0) lines.push(zh ? `待清洁：${pendingCleaning.map((item) => item.room_no ?? "?").join("、")}` : `Ménage : ${pendingCleaning.map((item) => item.room_no ?? "?").join(", ")}`);
    return { intent: ctx.intent, reply: withWarnings(lines.join("\n")), usedContext: ["getDailyTodayOverview"] };
  }

  if (ctx.intent === "daily_today_checkouts") {
    const checkouts = (data.checkouts ?? []) as Record<string, unknown>[];
    if (checkouts.length === 0) {
      return { intent: ctx.intent, reply: withWarnings(zh ? "今天没有日租退房。" : "Aucun départ journalier aujourd'hui."), usedContext: ["getTodayDailyCheckouts"] };
    }
    const lines = [zh ? `今天日租退房 ${checkouts.length} 间：` : `${checkouts.length} départ(s) journalier(s) aujourd'hui :`];
    for (const item of checkouts) {
      lines.push(
        zh
          ? `${item.room_no ?? "未知房号"}｜客户：${item.customer_name ?? "未登记"}｜状态：${item.status ?? "-"}｜尾款：${money(item.remaining_amount_xof)}｜清洁：${item.cleaning_status ?? "none"}`
          : `${item.room_no ?? "?"} | Client: ${item.customer_name ?? "non renseigné"} | Statut: ${item.status ?? "-"} | Solde: ${money(item.remaining_amount_xof)} | Ménage: ${item.cleaning_status ?? "none"}`,
      );
    }
    return { intent: ctx.intent, reply: withWarnings(lines.join("\n")), usedContext: ["getTodayDailyCheckouts"] };
  }

  if (ctx.intent === "daily_today_checkins") {
    const checkins = (data.checkins ?? []) as Record<string, unknown>[];
    if (checkins.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "今天没有日租入住。" : "Aucune arrivée journalière aujourd'hui."), usedContext: ["getTodayDailyCheckins"] };
    const lines = [zh ? `今天日租入住 ${checkins.length} 间：` : `${checkins.length} arrivée(s) journalière(s) aujourd'hui :`];
    for (const item of checkins) {
      lines.push(zh
        ? `${item.room_no ?? "未知房号"}｜客户：${item.customer_name ?? "未登记"}｜状态：${item.status ?? "-"}｜已收：${money(item.paid_amount_xof)}｜尾款：${money(item.remaining_amount_xof)}`
        : `${item.room_no ?? "?"} | Client: ${item.customer_name ?? "non renseigné"} | Statut: ${item.status ?? "-"} | Payé: ${money(item.paid_amount_xof)} | Solde: ${money(item.remaining_amount_xof)}`);
    }
    return { intent: ctx.intent, reply: withWarnings(lines.join("\n")), usedContext: ["getTodayDailyCheckins"] };
  }

  if (ctx.intent === "daily_cleaning_tasks") {
    const tasks = (data.tasks ?? []) as Record<string, unknown>[];
    if (tasks.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "当前没有查到清洁任务。" : "Aucune tâche de ménage trouvée."), usedContext: ["getCleaningTasks"] };
    const pending = tasks.filter((task) => task.is_completed === false);
    const done = tasks.filter((task) => task.is_completed === true);
    const lines = [zh ? `清洁任务：待完成 ${pending.length} 个，今日/最近完成 ${done.length} 个。` : `Ménage : ${pending.length} en attente, ${done.length} terminé(s).`];
    for (const task of tasks.slice(0, 15)) {
      lines.push(zh
        ? `${task.room_no ?? "未知房号"}｜${task.is_completed ? "已完成" : "待清洁"}｜${task.completed_at ? `完成时间：${String(task.completed_at).slice(0, 16).replace("T", " ")}` : `创建：${String(task.created_at ?? "").slice(0, 16).replace("T", " ")}`}`
        : `${task.room_no ?? "?"} | ${task.is_completed ? "terminé" : "en attente"} | ${String((task.completed_at ?? task.created_at) || "").slice(0, 16).replace("T", " ")}`);
    }
    return { intent: ctx.intent, reply: withWarnings(lines.join("\n")), usedContext: ["getCleaningTasks"] };
  }

  if (ctx.intent === "daily_available_rooms") {
    const rooms = (data.rooms ?? []) as Record<string, unknown>[];
    if (rooms.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "当前没有可安排日租入住的空房。" : "Aucune chambre journalière disponible."), usedContext: ["getAvailableDailyRooms"] };
    return {
      intent: ctx.intent,
      reply: withWarnings(zh ? `当前可安排日租入住 ${rooms.length} 间：${rooms.map((r) => r.room_no).join("、")}` : `${rooms.length} chambre(s) disponible(s) : ${rooms.map((r) => r.room_no).join(", ")}`),
      usedContext: ["getAvailableDailyRooms"],
    };
  }

  if (ctx.intent === "audit_activity") {
    const logs = (data.logs ?? []) as Record<string, unknown>[];
    if (logs.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "今天没有查到相关审计日志。" : "Aucun journal d'audit trouvé aujourd'hui."), usedContext: ["getAuditActivity"] };
    const lines = [zh ? `查到 ${logs.length} 条相关操作：` : `${logs.length} opération(s) trouvée(s) :`];
    for (const log of logs.slice(0, 12)) {
      lines.push(zh
        ? `${String(log.created_at ?? "").slice(11, 16)}｜${formatActor(log)}｜${log.action ?? "-"}｜房间 ${log.room_no ?? log.entity_label ?? "-"}`
        : `${String(log.created_at ?? "").slice(11, 16)} | ${formatActor(log)} | ${log.action ?? "-"} | Chambre ${log.room_no ?? log.entity_label ?? "-"}`);
    }
    return { intent: ctx.intent, reply: withWarnings(lines.join("\n")), usedContext: ["getAuditActivity"] };
  }

  if (ctx.intent === "finance_receivables") {
    const receivables = (data.receivables ?? []) as Record<string, unknown>[];
    if (receivables.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "当前没有查到未结清应收。" : "Aucune créance ouverte trouvée."), usedContext: ["getFinanceReceivables"] };
    const total = receivables.reduce((sum, item) => sum + Number(item.outstanding_xof || 0), 0);
    const lines = [zh ? `当前未结清应收 ${receivables.length} 条，合计 ${money(total)}：` : `${receivables.length} créance(s), total ${money(total)} :`];
    for (const item of receivables.slice(0, 15)) {
      lines.push(zh
        ? `${item.room_no ?? "-"}｜${item.customer_name ?? "未登记"}｜${item.title ?? item.category}｜未收 ${money(item.outstanding_xof)}｜到期 ${item.due_date ?? "-"}`
        : `${item.room_no ?? "-"} | ${item.customer_name ?? "non renseigné"} | ${item.title ?? item.category} | Solde ${money(item.outstanding_xof)} | Échéance ${item.due_date ?? "-"}`);
    }
    return { intent: ctx.intent, reply: withWarnings(lines.join("\n")), usedContext: ["getFinanceReceivables"] };
  }

  if (ctx.intent === "room_profile") {
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown> | null>;
    const lines: string[] = [];
    for (const [roomNo, profile] of Object.entries(profiles)) {
      if (!profile) {
        lines.push(zh ? `${roomNo}：没有查到这个房间。` : `${roomNo}: chambre introuvable.`);
        continue;
      }
      const unit = profile.unit as Record<string, unknown>;
      const daily = (profile.daily as Record<string, unknown>[] | undefined) ?? [];
      const lease = (profile.lease as Record<string, unknown>[] | undefined) ?? [];
      const sale = (profile.sale as Record<string, unknown>[] | undefined) ?? [];
      const receivables = (profile.receivables as Record<string, unknown>[] | undefined) ?? [];
      const payments = (profile.payments as Record<string, unknown>[] | undefined) ?? [];
      const outstanding = receivables.reduce((sum, item) => sum + Math.max(0, Number(item.amount_xof || 0) - Number(item.paid_amount_xof || 0)), 0);
      lines.push(zh ? `${roomNo} 当前状态：${unit.status ?? "-"}` : `${roomNo}: statut ${unit.status ?? "-"}`);
      if (daily[0]) lines.push(zh ? `日租：${daily[0].check_in} → ${daily[0].check_out ?? "未定"}，${daily[0].status}` : `Jour: ${daily[0].check_in} → ${daily[0].check_out ?? "ouvert"}, ${daily[0].status}`);
      if (lease[0]) lines.push(zh ? `长租：${lease[0].start_date} → ${lease[0].expected_end_date}，月租 ${money(lease[0].monthly_rent_xof)}` : `Bail: ${lease[0].start_date} → ${lease[0].expected_end_date}, ${money(lease[0].monthly_rent_xof)}/mois`);
      if (sale[0]) lines.push(zh ? `出售：${sale[0].contract_no ?? "-"}，总价 ${money(sale[0].total_amount_xof)}` : `Vente: ${sale[0].contract_no ?? "-"}, ${money(sale[0].total_amount_xof)}`);
      lines.push(zh ? `收款记录 ${payments.length} 条，未结清应收 ${money(outstanding)}。` : `${payments.length} paiement(s), créances ouvertes ${money(outstanding)}.`);
    }
    return { intent: ctx.intent, reply: withWarnings(lines.join("\n")), usedContext: ["getRoomFullProfile"] };
  }

  if (ctx.intent === "business_draft") {
    const draft = ctx.draft ?? null;
    if (!draft) return { intent: ctx.intent, reply: zh ? "我没能生成操作草稿，因为缺少房号。" : "Je n'ai pas pu préparer le brouillon : chambre manquante.", requiresConfirmation: false };
    const missing = draft.missing?.filter(Boolean) ?? [];
    const text = zh
      ? `我准备好了一个操作草稿：${draft.action}，房间 ${draft.room_no ?? draft.room ?? "-"}${draft.amount_xof ? `，金额 ${money(draft.amount_xof)}` : ""}。${missing.length ? `但还缺少：${missing.join("、")}，暂时不能直接确认。` : "这还没有写入数据库，需要确认后再执行。"}`
      : `Brouillon préparé : ${draft.action}, chambre ${draft.room_no ?? draft.room ?? "-"}${draft.amount_xof ? `, montant ${money(draft.amount_xof)}` : ""}. ${missing.length ? `Champs manquants : ${missing.join(", ")}.` : "Rien n'a été écrit en base."}`;
    return { intent: ctx.intent, reply: withWarnings(text), draft, requiresConfirmation: missing.length === 0, usedContext: ["buildDraft"] };
  }

  return { intent: ctx.intent, reply: zh ? "我还没有理解这个问题。你可以换一种更接近日常业务的说法。" : "Je n'ai pas encore compris. Reformulez avec le contexte métier.", requiresConfirmation: false };
}

function canConfirmDraft(
  user: { role?: string | null; id?: string; displayName?: string | null },
  draft: AssistantDraft,
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = user as any;
  switch (draft.action) {
    case "record_payment": return hasPermission(u, "finance:write");
    case "complete_cleaning":
    case "check_in":
    case "check_out":
      return hasPermission(u, "daily_rentals:write");
    default:
      return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = await req.json();
    const message = String(body.message ?? "").trim();
    const locale = (String(body.locale ?? "zh") === "fr" ? "fr" : "zh") as Locale;
    const history = (body.history ?? []) as HistoryEntry[];
    if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

    const ctx = await buildAssistantContext(message, user, locale, history);
    let result: AssistantResult | null = null;

    const contextPrompt = buildContextPrompt(ctx);
    const systemMsg = buildSystemPrompt(locale, contextPrompt);
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (DETERMINISTIC_INTENTS.has(ctx.intent)) {
      result = fallbackReply(ctx, locale);
    } else if (apiKey) {
      const messages: { role: string; content: string }[] = [{ role: "system", content: systemMsg }];
      for (const h of history.slice(-10)) messages.push({ role: h.role, content: h.content });
      messages.push({ role: "user", content: message });

      const aiResponse = await chatWithDeepSeek(messages);
      if (aiResponse) {
        const parsed = extractJson(aiResponse);
        result = {
          reply: String(parsed.reply ?? "").trim(),
          intent: (parsed.intent as AssistantIntent) || ctx.intent,
          draft: (parsed.draft as AssistantDraft | null) ?? ctx.draft ?? null,
          requiresConfirmation: parsed.requiresConfirmation === true,
          usedContext: (parsed.usedContext as string[]) ?? [String((ctx.toolContext as Record<string, unknown>).tool ?? "tool")],
        };
        if (!result.reply) result = null;
      }
    }

    if (!result) result = fallbackReply(ctx, locale);

    if (ctx.draft && !result.draft) result.draft = ctx.draft;
    const isDraft = result.intent === "business_draft" || !!result.draft;
    const allowed = !isDraft || (result.draft ? canConfirmDraft(user, result.draft) : false);
    const missing = result.draft?.missing?.filter(Boolean) ?? [];

    return NextResponse.json({
      reply: allowed ? result.reply : (locale === "zh" ? "你当前账号没有执行此类操作的权限。" : "Votre compte n'a pas cette permission."),
      intent: result.intent,
      draft: result.draft ?? null,
      requiresConfirmation: allowed && isDraft && missing.length === 0 && (result.requiresConfirmation ?? true),
      executable: false,
      usedContext: result.usedContext ?? [],
    });
  } catch (error) {
    console.error("assistant error", error);
    return NextResponse.json(
      { error: "Assistant failed", reply: "AI助手暂时不可用，请稍后重试。" },
      { status: 500 },
    );
  }
}
