import { createClient } from "@/lib/supabase/server";

export type AssistantInsightSeverity = "high" | "medium" | "low";

export interface AssistantInsight {
  id: string;
  severity: AssistantInsightSeverity;
  title: string;
  detail: string;
  roomNo?: string | null;
  actionHint: string;
}

function related<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function getAssistantOperationInsights(locale: "zh" | "fr" = "zh") {
  const zh = locale === "zh";
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: cleaningTasks },
    { data: checkouts },
    { data: checkins },
    { data: receivables },
    { data: legacyLeases },
  ] = await Promise.all([
    supabase
      .from("cleaning_tasks")
      .select("id, unit_id, created_at, units(unit_no)")
      .eq("is_completed", false)
      .order("created_at", { ascending: true })
      .limit(20),
    supabase
      .from("daily_bookings")
      .select("id, unit_id, check_out, status, units(unit_no), customers(name)")
      .eq("check_out", today)
      .in("status", ["pending_review", "confirmed", "checked_in"])
      .limit(20),
    supabase
      .from("daily_bookings")
      .select("id, unit_id, check_in, status, customers(name), units(unit_no)")
      .eq("check_in", today)
      .in("status", ["pending_review", "confirmed"])
      .limit(20),
    supabase
      .from("receivables")
      .select("id, unit_id, title, due_date, amount_xof, paid_amount_xof, units(unit_no), customers(name)")
      .not("status", "in", "(paid,cancelled)")
      .lte("due_date", today)
      .order("due_date", { ascending: true })
      .limit(20),
    supabase
      .from("lease_contracts")
      .select("id, unit_id, contract_no, start_date, units(unit_no), customers(name)")
      .like("contract_no", "LEGACY-LEASE-%")
      .eq("status", "active")
      .limit(20),
  ]);

  const insights: AssistantInsight[] = [];

  for (const task of cleaningTasks ?? []) {
    const unit = related(task.units as { unit_no?: string } | { unit_no?: string }[] | null);
    insights.push({
      id: `cleaning:${task.id}`,
      severity: "medium",
      title: zh ? "待完成清洁" : "Ménage à terminer",
      detail: zh ? `${unit?.unit_no ?? "-"} 仍有未完成清洁任务。` : `${unit?.unit_no ?? "-"} a encore une tâche de ménage ouverte.`,
      roomNo: unit?.unit_no ?? null,
      actionHint: zh ? `${unit?.unit_no ?? ""} 已清洁完毕` : `${unit?.unit_no ?? ""} ménage terminé`,
    });
  }

  for (const booking of checkouts ?? []) {
    const unit = related(booking.units as { unit_no?: string } | { unit_no?: string }[] | null);
    const customer = related(booking.customers as { name?: string } | { name?: string }[] | null);
    insights.push({
      id: `checkout:${booking.id}`,
      severity: booking.status === "checked_in" ? "high" : "medium",
      title: zh ? "今日退房待处理" : "Départ aujourd'hui",
      detail: zh ? `${unit?.unit_no ?? "-"} ${customer?.name ?? ""} 今日退房，状态 ${booking.status}。` : `${unit?.unit_no ?? "-"} ${customer?.name ?? ""}, départ aujourd'hui, statut ${booking.status}.`,
      roomNo: unit?.unit_no ?? null,
      actionHint: zh ? `${unit?.unit_no ?? ""} 今日退房` : `${unit?.unit_no ?? ""} départ aujourd'hui`,
    });
  }

  for (const booking of checkins ?? []) {
    const unit = related(booking.units as { unit_no?: string } | { unit_no?: string }[] | null);
    const customer = related(booking.customers as { name?: string } | { name?: string }[] | null);
    insights.push({
      id: `checkin:${booking.id}`,
      severity: "low",
      title: zh ? "今日入住待跟进" : "Arrivée aujourd'hui",
      detail: zh ? `${unit?.unit_no ?? "-"} ${customer?.name ?? ""} 今日入住，状态 ${booking.status}。` : `${unit?.unit_no ?? "-"} ${customer?.name ?? ""}, arrivée aujourd'hui, statut ${booking.status}.`,
      roomNo: unit?.unit_no ?? null,
      actionHint: zh ? `查看 ${unit?.unit_no ?? ""} 入住情况` : `Voir arrivée ${unit?.unit_no ?? ""}`,
    });
  }

  for (const receivable of receivables ?? []) {
    const unit = related(receivable.units as { unit_no?: string } | { unit_no?: string }[] | null);
    const outstanding = Number(receivable.amount_xof ?? 0) - Number(receivable.paid_amount_xof ?? 0);
    if (outstanding <= 0) continue;
    insights.push({
      id: `receivable:${receivable.id}`,
      severity: "high",
      title: zh ? "到期未结应收" : "Créance échue",
      detail: zh ? `${unit?.unit_no ?? "-"} ${receivable.title ?? ""} 未收 ${outstanding.toLocaleString("zh-CN")} FCFA。` : `${unit?.unit_no ?? "-"} ${receivable.title ?? ""}, solde ${outstanding.toLocaleString("fr-FR")} FCFA.`,
      roomNo: unit?.unit_no ?? null,
      actionHint: zh ? `查询 ${unit?.unit_no ?? ""} 应收` : `Voir créance ${unit?.unit_no ?? ""}`,
    });
  }

  for (const contract of legacyLeases ?? []) {
    const unit = related(contract.units as { unit_no?: string } | { unit_no?: string }[] | null);
    insights.push({
      id: `legacy:${contract.id}`,
      severity: "low",
      title: zh ? "合同编号待整理" : "Numéro de bail à nettoyer",
      detail: zh ? `${unit?.unit_no ?? "-"} 仍使用 LEGACY 合同编号。` : `${unit?.unit_no ?? "-"} utilise encore un numéro LEGACY.`,
      roomNo: unit?.unit_no ?? null,
      actionHint: zh ? `${unit?.unit_no ?? ""} 整理合同编号` : `Nettoyer contrat ${unit?.unit_no ?? ""}`,
    });
  }

  const severityWeight: Record<AssistantInsightSeverity, number> = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => severityWeight[a.severity] - severityWeight[b.severity]);

  return {
    date: today,
    insights: insights.slice(0, 30),
    counts: {
      high: insights.filter((item) => item.severity === "high").length,
      medium: insights.filter((item) => item.severity === "medium").length,
      low: insights.filter((item) => item.severity === "low").length,
      total: insights.length,
    },
  };
}
