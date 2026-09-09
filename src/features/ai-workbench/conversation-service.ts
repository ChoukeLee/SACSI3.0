import "server-only";

import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n";

export interface ConversationTurnSummary {
  id: number;
  kind: "query" | "action_draft" | "receipt" | "action_result" | "error";
  userText: string;
  assistantText: string;
  context: Record<string, unknown>;
  createdAt: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertConversationId(value: string) {
  if (!UUID_PATTERN.test(value)) throw new Error("Invalid AI conversation id.");
}

export async function getOrCreateActiveConversation(locale: Locale) {
  const user = await requireAuth();
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("ai_conversations")
    .select("id, locale")
    .eq("actor_id", user.id)
    .eq("status", "active")
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`AI conversation lookup failed: ${readError.message}`);
  if (existing) return { id: String(existing.id), locale: existing.locale as Locale };

  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({ actor_id: user.id, locale, title: "AI Workbench", status: "active" })
    .select("id, locale")
    .single();
  if (error || !data) throw new Error(error?.message ?? "AI conversation creation failed.");
  return { id: String(data.id), locale: data.locale as Locale };
}

export async function loadConversationHistory(conversationId: string, limit = 12): Promise<ConversationTurnSummary[]> {
  await requireAuth();
  assertConversationId(conversationId);
  const supabase = await createClient();
  const safeLimit = Math.max(1, Math.min(30, Math.trunc(limit)));
  const { data, error } = await supabase
    .from("ai_conversation_turns")
    .select("id, turn_kind, user_text, assistant_text, context_snapshot, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(`AI conversation history failed: ${error.message}`);
  return (data ?? []).reverse().map((turn) => ({
    id: Number(turn.id),
    kind: turn.turn_kind as ConversationTurnSummary["kind"],
    userText: String(turn.user_text),
    assistantText: String(turn.assistant_text),
    context: (turn.context_snapshot ?? {}) as Record<string, unknown>,
    createdAt: String(turn.created_at),
  }));
}

export async function appendConversationTurn(input: {
  conversationId: string;
  kind: ConversationTurnSummary["kind"];
  userText: string;
  assistantText: string;
  jobId?: string | null;
  context?: Record<string, unknown>;
}) {
  const user = await requireAuth();
  assertConversationId(input.conversationId);
  const userText = input.userText.trim().slice(0, 2000);
  const assistantText = input.assistantText.trim().slice(0, 4000);
  if (!userText || !assistantText) throw new Error("Conversation turn text is required.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversation_turns")
    .insert({
      conversation_id: input.conversationId,
      actor_id: user.id,
      job_id: input.jobId ?? null,
      turn_kind: input.kind,
      user_text: userText,
      assistant_text: assistantText,
      context_snapshot: input.context ?? {},
    })
    .select("id, created_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "AI conversation turn save failed.");
  const { error: touchError } = await supabase
    .from("ai_conversations")
    .update({ last_message_at: data.created_at })
    .eq("id", input.conversationId);
  if (touchError) throw new Error(`AI conversation update failed: ${touchError.message}`);
  return data;
}

export async function loadRecentConversationContexts(conversationId: string, limit = 6) {
  const history = await loadConversationHistory(conversationId, Math.max(1, Math.min(8, Math.trunc(limit))));
  return history.map((turn) => turn.context);
}
