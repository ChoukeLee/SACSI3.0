"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  draft?: Record<string, unknown> | null;
  requiresConfirmation?: boolean;
}

interface AssistantResponse {
  reply?: string;
  intent?: string;
  draft?: Record<string, unknown> | null;
  requiresConfirmation?: boolean;
  error?: string;
}

const EXAMPLES_ZH = [
  "602现在什么状态？",
  "今天有哪些清洁任务？",
  "103收到租金195万",
  "你能帮我做什么？",
];
const EXAMPLES_FR = [
  "Statut de la chambre 602 ?",
  "Quelles chambres sont en ménage ?",
  "Paiement 1 950 000 pour le 103",
  "Que peux-tu faire ?",
];

export function GlobalSearch({ locale }: { locale: "zh" | "fr" }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const zh = locale === "zh";
  const examples = zh ? EXAMPLES_ZH : EXAMPLES_FR;

  // Ctrl+K
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Focus + reset on open
  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Scroll to bottom on new messages
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/assistant/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, locale }),
      });
      const data = (await res.json()) as AssistantResponse;
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: res.ok ? (data.reply ?? data.error ?? "?") : (data.error ?? (zh ? "AI助手暂时不可用" : "Assistant indisponible")),
        draft: data.draft ?? null,
        requiresConfirmation: data.requiresConfirmation ?? false,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: zh ? "连接失败，请稍后重试。" : "Connexion échouée." }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, locale, zh]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const handleClose = () => { setOpen(false); setMessages([]); setInput(""); };

  if (!open) {
    return (
      <>
        <button onClick={() => setOpen(true)} className="hidden items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/70 sm:flex">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{zh ? "AI 助理…" : "Assistant IA…"}</span>
          <kbd className="hidden rounded-md border border-border bg-white px-1.5 py-0 font-mono text-[10px] text-muted-foreground/60 lg:inline">Ctrl+K</kbd>
        </button>
        <button onClick={() => setOpen(true)} className="flex items-center justify-center rounded-lg border border-border bg-muted/50 p-1.5 text-muted-foreground hover:bg-muted sm:hidden">
          <Sparkles className="h-4 w-4" />
        </button>
      </>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[8vh] sm:pt-[10vh]" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[1px]" />
      <div
        className="relative mx-2 flex h-[85vh] max-h-[640px] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border/60 px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-semibold">{zh ? "SACIS 助理" : "Assistant SACIS"}</p>
            <p className="text-[10px] text-muted-foreground">{zh ? "后台业务助手 · 生成草稿需确认后执行" : "Brouillons à confirmer avant exécution"}</p>
          </div>
          <button onClick={handleClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Messages / Empty state ── */}
        <div ref={listRef} className="flex-1 overflow-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">{zh ? "SACIS 后台助理" : "Assistant SACIS"}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {zh ? "我是你的业务助手。可以查询房态、生成操作草稿、回答业务问题。" : "Je peux vous aider avec les chambres, les opérations et les questions métier."}
                </p>
              </div>
              <div className="grid gap-2 w-full max-w-xs">
                {examples.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => { setInput(text); setTimeout(() => inputRef.current?.focus(), 50); }}
                    className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:border-primary/20 hover:bg-accent hover:text-foreground"
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatBubble key={i} msg={msg} locale={locale} />
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {zh ? "正在思考……" : "Réflexion en cours…"}
            </div>
          )}
        </div>

        {/* ── Input ── */}
        <div className="shrink-0 border-t border-border/60 p-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={zh ? "问我任何后台业务……" : "Posez-moi une question…"}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              className="shrink-0 rounded-lg bg-primary p-1.5 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Sparkles className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ═══════════════════════════════════════════
// Chat bubble
// ═══════════════════════════════════════════

function ChatBubble({ msg, locale }: { msg: ChatMessage; locale: string }) {
  const isUser = msg.role === "user";
  const zh = locale === "zh";

  return (
    <div className={cn("flex gap-2.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div className={cn(
        "max-w-[85%] space-y-2",
        isUser ? "items-end" : "items-start",
      )}>
        <div className={cn(
          "rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted/60 text-foreground rounded-bl-md",
        )}>
          <div className="whitespace-pre-wrap">{msg.content}</div>
        </div>
        {msg.draft && !isUser && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 mb-1.5">
              {zh ? "操作草稿" : "Brouillon"}
            </p>
            <DraftCard draft={msg.draft} locale={locale} />
            {msg.requiresConfirmation && (
              <p className="mt-2 text-[11px] text-amber-700/80">
                {zh ? "以上为识别结果，需要你确认后才会写入数据库。" : "Ce brouillon doit être confirmé avant écriture."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DraftCard({ draft, locale }: { draft: Record<string, unknown>; locale: string }) {
  const zh = locale === "zh";
  const action = draft.action as string ?? "";
  const room = draft.room as string ?? "";
  const amount = draft.amount_xof as number | undefined;
  const date = draft.date as string | undefined;
  const labels: Record<string, string> = {
    record_payment: zh ? "记录收款" : "Enregistrer paiement",
    complete_cleaning: zh ? "完成清洁" : "Ménage terminé",
    check_in: zh ? "办理入住" : "Check-in",
    check_out: zh ? "办理退房" : "Check-out",
  };

  return (
    <div className="space-y-1 text-[12px]">
      <div className="flex gap-2">
        <span className="text-muted-foreground">{zh ? "操作" : "Action"}:</span>
        <span className="font-semibold text-foreground">{labels[action] ?? action}</span>
      </div>
      {room && (
        <div className="flex gap-2">
          <span className="text-muted-foreground">{zh ? "房间" : "Chambre"}:</span>
          <span className="font-semibold text-foreground">{room}</span>
        </div>
      )}
      {amount && (
        <div className="flex gap-2">
          <span className="text-muted-foreground">{zh ? "金额" : "Montant"}:</span>
          <span className="font-semibold text-foreground">{amount.toLocaleString()} XOF</span>
        </div>
      )}
      {date && (
        <div className="flex gap-2">
          <span className="text-muted-foreground">{zh ? "日期" : "Date"}:</span>
          <span className="font-semibold text-foreground">{date}</span>
        </div>
      )}
    </div>
  );
}
