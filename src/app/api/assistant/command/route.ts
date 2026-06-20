import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { auditActionLabel } from "@/lib/audit-labels";
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
    "You should feel like a capable colleague: understand the user, answer like a helpful colleague — conversational, direct, no fluff.",
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

const money = (value: unknown, locale: Locale = "zh") => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString(locale === "fr" ? "fr-FR" : "zh-CN")} FCFA`;
};

function formatActor(log: Record<string, unknown>) {
  return log.actor_display_name || log.actor_email || log.actor_role || "未知操作人";
}

function joinRooms(items: unknown[], locale: Locale) {
  return items.map((item) => String(item || "?")).join(locale === "fr" ? ", " : "、");
}

function dailyStatusLabel(status: unknown, locale: Locale) {
  const zh: Record<string, string> = {
    pending_review: "待确认",
    confirmed: "已确认",
    checked_in: "在住",
    checked_out: "已退房",
    cancelled: "已取消",
  };
  const fr: Record<string, string> = {
    pending_review: "à confirmer",
    confirmed: "confirmée",
    checked_in: "occupée",
    checked_out: "départ terminé",
    cancelled: "annulée",
  };
  const key = String(status || "");
  return (locale === "fr" ? fr[key] : zh[key]) ?? (status ? String(status) : "-");
}

function checkoutStatePhrase(status: unknown, locale: Locale) {
  const key = String(status || "");
  if (locale === "fr") {
    if (key === "checked_in") return "elle est encore marquée comme occupée dans le système";
    if (key === "checked_out") return "le départ est déjà terminé dans le système";
    if (key === "confirmed") return "la réservation est confirmée et le départ est prévu aujourd'hui";
    if (key === "pending_review") return "la réservation attend confirmation, avec départ prévu aujourd'hui";
    return `statut : ${dailyStatusLabel(status, locale)}`;
  }
  if (key === "checked_in") return "系统里仍显示在住，说明退房还没有正式完成";
  if (key === "checked_out") return "系统里已经完成退房";
  if (key === "confirmed") return "预订已确认，今天是预计退房日";
  if (key === "pending_review") return "预订还在待确认，但退房日期是今天";
  return `状态是${dailyStatusLabel(status, locale)}`;
}

function checkinStatePhrase(status: unknown, locale: Locale) {
  const key = String(status || "");
  if (locale === "fr") {
    if (key === "checked_in") return "elle est déjà enregistrée comme arrivée";
    if (key === "confirmed") return "l'arrivée est confirmée pour aujourd'hui";
    if (key === "pending_review") return "l'arrivée attend encore confirmation";
    return `statut : ${dailyStatusLabel(status, locale)}`;
  }
  if (key === "checked_in") return "已经办理入住";
  if (key === "confirmed") return "今天预计入住，预订已确认";
  if (key === "pending_review") return "今天预计入住，但预订还在待确认";
  return `状态是${dailyStatusLabel(status, locale)}`;
}

function cleaningText(status: unknown, locale: Locale) {
  const key = String(status || "none");
  if (locale === "fr") {
    if (key === "completed") return "ménage terminé";
    if (key === "pending") return "ménage à faire";
    return "aucune tâche de ménage ouverte";
  }
  if (key === "completed") return "清洁已完成";
  if (key === "pending") return "待清洁";
  return "没有未完成的清洁任务";
}

function remainingText(value: unknown, locale: Locale) {
  const amount = Number(value || 0);
  if (amount <= 0) return locale === "fr" ? "solde réglé" : "尾款已结清";
  return locale === "fr" ? `solde restant ${money(amount, locale)}` : `还需收尾款 ${money(amount, locale)}`;
}

function unitStatusLabel(status: unknown, locale: Locale) {
  const zh: Record<string, string> = {
    available: "空闲",
    daily_occupied: "日租中",
    reserved: "已预订",
    cleaning: "待清洁",
    cleaning_pending: "待清洁",
    maintenance: "维修中",
    locked: "锁定",
    leased: "长租中",
    sold: "已出售",
  };
  const fr: Record<string, string> = {
    available: "disponible",
    daily_occupied: "location journalière en cours",
    reserved: "réservée",
    cleaning: "ménage à faire",
    cleaning_pending: "ménage à faire",
    maintenance: "maintenance",
    locked: "bloquée",
    leased: "louée en longue durée",
    sold: "vendue",
  };
  const key = String(status || "");
  return (locale === "fr" ? fr[key] : zh[key]) ?? (status ? String(status) : "-");
}

function actionLabel(action: unknown, locale: Locale) {
  return auditActionLabel(action, locale);
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
    const overviewCheckouts = (data.checkouts ?? []) as Record<string, unknown>[];
    const overviewCheckins = (data.checkins ?? []) as Record<string, unknown>[];
    const overviewCleaningTasks = (data.cleaningTasks ?? []) as Record<string, unknown>[];
    const overviewAvailableRooms = (data.availableRooms ?? []) as Record<string, unknown>[];
    const overviewPendingCleaning = overviewCleaningTasks.filter((task) => task.is_completed === false);
    const overviewLines = [
      zh
        ? `今天日租业务概况：预计退房 ${overviewCheckouts.length} 间，预计入住 ${overviewCheckins.length} 间，待清洁 ${overviewPendingCleaning.length} 间，可安排入住 ${overviewAvailableRooms.length} 间。`
        : `Aujourd'hui : ${overviewCheckouts.length} départ(s), ${overviewCheckins.length} arrivée(s), ${overviewPendingCleaning.length} ménage(s), ${overviewAvailableRooms.length} disponible(s).`,
    ];
    if (overviewCheckouts.length > 0) overviewLines.push(zh ? `预计退房：${joinRooms(overviewCheckouts.map((item) => item.room_no), locale)}` : `Départs prévus : ${joinRooms(overviewCheckouts.map((item) => item.room_no), locale)}`);
    if (overviewCheckins.length > 0) overviewLines.push(zh ? `预计入住：${joinRooms(overviewCheckins.map((item) => item.room_no), locale)}` : `Arrivées prévues : ${joinRooms(overviewCheckins.map((item) => item.room_no), locale)}`);
    if (overviewPendingCleaning.length > 0) overviewLines.push(zh ? `待清洁：${joinRooms(overviewPendingCleaning.map((item) => item.room_no), locale)}` : `Ménage à faire : ${joinRooms(overviewPendingCleaning.map((item) => item.room_no), locale)}`);
    return { intent: ctx.intent, reply: withWarnings(overviewLines.join("\n")), usedContext: ["getDailyTodayOverview"] };
  }

  if (ctx.intent === "daily_today_checkouts") {
    const directCheckouts = (data.checkouts ?? []) as Record<string, unknown>[];
    if (directCheckouts.length === 0) {
      return { intent: ctx.intent, reply: withWarnings(zh ? "今天没有日租退房。" : "Aucun départ journalier aujourd'hui."), usedContext: ["getTodayDailyCheckouts"] };
    }
    const directLines = [
      zh
        ? `今天有 ${directCheckouts.length} 间日租房预计退房：${joinRooms(directCheckouts.map((item) => item.room_no), locale)}。`
        : `Aujourd'hui, ${directCheckouts.length} chambre(s) en location journalière ont un départ prévu : ${joinRooms(directCheckouts.map((item) => item.room_no), locale)}.`,
    ];
    for (const item of directCheckouts) {
      const room = item.room_no ?? (zh ? "未知房号" : "?");
      const customer = item.customer_name ?? (zh ? "未登记客户" : "client non renseigné");
      directLines.push(zh
        ? `${room}：客户 ${customer}，${checkoutStatePhrase(item.status, locale)}，${remainingText(item.remaining_amount_xof, locale)}，${cleaningText(item.cleaning_status, locale)}。`
        : `${room} : ${customer}, ${checkoutStatePhrase(item.status, locale)}, ${remainingText(item.remaining_amount_xof, locale)}, ${cleaningText(item.cleaning_status, locale)}.`);
    }
    return { intent: ctx.intent, reply: withWarnings(directLines.join("\n")), usedContext: ["getTodayDailyCheckouts"] };
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
    const directCheckins = (data.checkins ?? []) as Record<string, unknown>[];
    if (directCheckins.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "今天没有日租入住。" : "Aucune arrivée journalière aujourd'hui."), usedContext: ["getTodayDailyCheckins"] };
    const directLines = [
      zh
        ? `今天有 ${directCheckins.length} 间日租房预计入住：${joinRooms(directCheckins.map((item) => item.room_no), locale)}。`
        : `Aujourd'hui, ${directCheckins.length} chambre(s) ont une arrivée prévue : ${joinRooms(directCheckins.map((item) => item.room_no), locale)}.`,
    ];
    for (const item of directCheckins) {
      const room = item.room_no ?? (zh ? "未知房号" : "?");
      const customer = item.customer_name ?? (zh ? "未登记客户" : "client non renseigné");
      directLines.push(zh
        ? `${room}：客户 ${customer}，${checkinStatePhrase(item.status, locale)}，已收 ${money(item.paid_amount_xof, locale)}，${remainingText(item.remaining_amount_xof, locale)}。`
        : `${room} : ${customer}, ${checkinStatePhrase(item.status, locale)}, payé ${money(item.paid_amount_xof, locale)}, ${remainingText(item.remaining_amount_xof, locale)}.`);
    }
    return { intent: ctx.intent, reply: withWarnings(directLines.join("\n")), usedContext: ["getTodayDailyCheckins"] };
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
    const directTasks = (data.tasks ?? []) as Record<string, unknown>[];
    if (directTasks.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "当前没有查到清洁任务。" : "Aucune tâche de ménage trouvée."), usedContext: ["getCleaningTasks"] };
    const directPending = directTasks.filter((task) => task.is_completed === false);
    const directDone = directTasks.filter((task) => task.is_completed === true);
    const directLines = [
      zh
        ? `当前清洁任务：待完成 ${directPending.length} 个，已完成 ${directDone.length} 个。`
        : `Ménage : ${directPending.length} en attente, ${directDone.length} terminé(s).`,
    ];
    for (const task of directTasks.slice(0, 15)) {
      const time = String((task.completed_at ?? task.created_at) || "").slice(0, 16).replace("T", " ");
      directLines.push(zh
        ? `${task.room_no ?? "未知房号"}：${task.is_completed ? "清洁已完成" : "待清洁"}${time ? `，时间 ${time}` : ""}。`
        : `${task.room_no ?? "?"} : ${task.is_completed ? "ménage terminé" : "ménage à faire"}${time ? `, ${time}` : ""}.`);
    }
    return { intent: ctx.intent, reply: withWarnings(directLines.join("\n")), usedContext: ["getCleaningTasks"] };
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
    const directRooms = (data.rooms ?? []) as Record<string, unknown>[];
    if (directRooms.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "当前没有可安排日租入住的空房。" : "Aucune chambre journalière disponible."), usedContext: ["getAvailableDailyRooms"] };
    return {
      intent: ctx.intent,
      reply: withWarnings(zh ? `当前可安排日租入住 ${directRooms.length} 间：${joinRooms(directRooms.map((r) => r.room_no), locale)}。` : `${directRooms.length} chambre(s) disponible(s) : ${joinRooms(directRooms.map((r) => r.room_no), locale)}.`),
      usedContext: ["getAvailableDailyRooms"],
    };
    const rooms = (data.rooms ?? []) as Record<string, unknown>[];
    if (rooms.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "当前没有可安排日租入住的空房。" : "Aucune chambre journalière disponible."), usedContext: ["getAvailableDailyRooms"] };
    return {
      intent: ctx.intent,
      reply: withWarnings(zh ? `当前可安排日租入住 ${rooms.length} 间：${rooms.map((r) => r.room_no).join("、")}` : `${rooms.length} chambre(s) disponible(s) : ${rooms.map((r) => r.room_no).join(", ")}`),
      usedContext: ["getAvailableDailyRooms"],
    };
  }

  if (ctx.intent === "audit_activity") {
    const directLogs = (data.logs ?? []) as Record<string, unknown>[];
    if (directLogs.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "今天没有查到相关操作记录。" : "Aucun journal d'audit trouvé aujourd'hui."), usedContext: ["getAuditActivity"] };
    const directLines = [zh ? `查到 ${directLogs.length} 条相关操作记录：` : `${directLogs.length} opération(s) trouvée(s) :`];
    for (const log of directLogs.slice(0, 12)) {
      const time = String(log.created_at ?? "").slice(11, 16);
      const room = log.room_no ?? log.entity_label ?? "-";
      directLines.push(zh
        ? `${time}，${formatActor(log)}，${actionLabel(log.action, locale)}，房间 ${room}。`
        : `${time}, ${formatActor(log)}, ${actionLabel(log.action, locale)}, chambre ${room}.`);
    }
    return { intent: ctx.intent, reply: withWarnings(directLines.join("\n")), usedContext: ["getAuditActivity"] };
    const logs = (data.logs ?? []) as Record<string, unknown>[];
    if (logs.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "今天没有查到相关审计日志。" : "Aucun journal d'audit trouvé aujourd'hui."), usedContext: ["getAuditActivity"] };
    const lines = [zh ? `查到 ${logs.length} 条相关操作：` : `${logs.length} opération(s) trouvée(s) :`];
    for (const log of logs.slice(0, 12)) {
      lines.push(zh
        ? `${String(log.created_at ?? "").slice(11, 16)}｜${formatActor(log)}｜${actionLabel(log.action, locale)}｜房间 ${log.room_no ?? log.entity_label ?? "-"}`
        : `${String(log.created_at ?? "").slice(11, 16)} | ${formatActor(log)} | ${actionLabel(log.action, locale)} | Chambre ${log.room_no ?? log.entity_label ?? "-"}`);
    }
    return { intent: ctx.intent, reply: withWarnings(lines.join("\n")), usedContext: ["getAuditActivity"] };
  }

  if (ctx.intent === "finance_receivables") {
    const directReceivables = (data.receivables ?? []) as Record<string, unknown>[];
    if (directReceivables.length === 0) return { intent: ctx.intent, reply: withWarnings(zh ? "当前没有查到未结清应收。" : "Aucune créance ouverte trouvée."), usedContext: ["getFinanceReceivables"] };
    const directTotal = directReceivables.reduce((sum, item) => sum + Number(item.outstanding_xof || 0), 0);
    const directLines = [zh ? `当前未结清应收 ${directReceivables.length} 条，合计 ${money(directTotal, locale)}：` : `${directReceivables.length} créance(s), total ${money(directTotal, locale)} :`];
    for (const item of directReceivables.slice(0, 15)) {
      directLines.push(zh
        ? `${item.room_no ?? "-"}：${item.customer_name ?? "未登记客户"}，${item.title ?? item.category ?? "应收款"}，未收 ${money(item.outstanding_xof, locale)}，到期日 ${item.due_date ?? "未定"}。`
        : `${item.room_no ?? "-"} : ${item.customer_name ?? "client non renseigné"}, ${item.title ?? item.category ?? "créance"}, solde ${money(item.outstanding_xof, locale)}, échéance ${item.due_date ?? "non fixée"}.`);
    }
    return { intent: ctx.intent, reply: withWarnings(directLines.join("\n")), usedContext: ["getFinanceReceivables"] };
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
    const directProfiles = (data.profiles ?? {}) as Record<string, Record<string, unknown> | null>;
    const directLines: string[] = [];
    for (const [roomNo, profile] of Object.entries(directProfiles)) {
      if (!profile) {
        directLines.push(zh ? `${roomNo}：没有查到这个房间。` : `${roomNo}: chambre introuvable.`);
        continue;
      }
      const safeProfile = profile as Record<string, unknown>;
      const unit = safeProfile.unit as Record<string, unknown>;
      const daily = (safeProfile.daily as Record<string, unknown>[] | undefined) ?? [];
      const lease = (safeProfile.lease as Record<string, unknown>[] | undefined) ?? [];
      const sale = (safeProfile.sale as Record<string, unknown>[] | undefined) ?? [];
      const receivables = (safeProfile.receivables as Record<string, unknown>[] | undefined) ?? [];
      const payments = (safeProfile.payments as Record<string, unknown>[] | undefined) ?? [];
      const outstanding = receivables.reduce((sum, item) => sum + Math.max(0, Number(item.amount_xof || 0) - Number(item.paid_amount_xof || 0)), 0);

      directLines.push(zh ? `${roomNo} 当前状态：${unitStatusLabel(unit.status, locale)}。` : `${roomNo}: ${unitStatusLabel(unit.status, locale)}.`);
      if (daily[0]) directLines.push(zh ? `日租记录：${daily[0].check_in} 到 ${daily[0].check_out ?? "未定"}，${dailyStatusLabel(daily[0].status, locale)}。` : `Journalier : ${daily[0].check_in} au ${daily[0].check_out ?? "non fixé"}, ${dailyStatusLabel(daily[0].status, locale)}.`);
      if (lease[0]) directLines.push(zh ? `长租记录：${lease[0].start_date} 到 ${lease[0].expected_end_date ?? "未定"}，月租 ${money(lease[0].monthly_rent_xof, locale)}。` : `Longue durée : ${lease[0].start_date} au ${lease[0].expected_end_date ?? "non fixé"}, ${money(lease[0].monthly_rent_xof, locale)}/mois.`);
      if (sale[0]) directLines.push(zh ? `出售记录：合同 ${sale[0].contract_no ?? "未登记"}，总价 ${money(sale[0].total_amount_xof, locale)}。` : `Vente : contrat ${sale[0].contract_no ?? "non renseigné"}, total ${money(sale[0].total_amount_xof, locale)}.`);
      directLines.push(zh ? `收款记录 ${payments.length} 条，未结清应收 ${money(outstanding, locale)}。` : `${payments.length} paiement(s), créances ouvertes ${money(outstanding, locale)}.`);
    }
    return { intent: ctx.intent, reply: withWarnings(directLines.join("\n")), usedContext: ["getRoomFullProfile"] };
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown> | null>;
    const lines: string[] = [];
    for (const [roomNo, profile] of Object.entries(profiles)) {
      if (!profile) {
        lines.push(zh ? `${roomNo}：没有查到这个房间。` : `${roomNo}: chambre introuvable.`);
        continue;
      }
      const safeProfile = profile as Record<string, unknown>;
      const unit = safeProfile.unit as Record<string, unknown>;
      const daily = (safeProfile.daily as Record<string, unknown>[] | undefined) ?? [];
      const lease = (safeProfile.lease as Record<string, unknown>[] | undefined) ?? [];
      const sale = (safeProfile.sale as Record<string, unknown>[] | undefined) ?? [];
      const receivables = (safeProfile.receivables as Record<string, unknown>[] | undefined) ?? [];
      const payments = (safeProfile.payments as Record<string, unknown>[] | undefined) ?? [];
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

    if (false) { // PERF: always use LLM for natural responses
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
