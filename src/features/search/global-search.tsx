"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  BedDouble,
  Building2,
  CreditCard,
  DollarSign,
  FileText,
  Home,
  Loader2,
  Receipt,
  Search,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { cn, formatXof } from "@/lib/utils";
import { globalSearch } from "./search-service";
import type { SearchResult, SearchResultType } from "./search-types";

interface AssistantResponse {
  reply?: string;
  draft?: Record<string, unknown> | null;
  requiresConfirmation?: boolean;
  error?: string;
}

const TYPE_ICONS: Record<SearchResultType, typeof Search> = {
  customer: User,
  unit: Building2,
  daily_booking: BedDouble,
  lease: Home,
  sale: CreditCard,
  receivable: Receipt,
  payment: DollarSign,
  document: FileText,
};

const TYPE_LABELS: Record<SearchResultType, Record<"zh" | "fr", string>> = {
  customer: { zh: "客户", fr: "Client" },
  unit: { zh: "房源", fr: "Logement" },
  daily_booking: { zh: "日租", fr: "Jour" },
  lease: { zh: "长租", fr: "Location" },
  sale: { zh: "出售", fr: "Vente" },
  receivable: { zh: "应收", fr: "Créance" },
  payment: { zh: "收款", fr: "Paiement" },
  document: { zh: "单据", fr: "Document" },
};

/** Detect if query looks like a natural-language business command (contains room number + action keyword). */
function looksLikeBusinessCommand(query: string): boolean {
  const hasRoom = /\b\d{3,4}\b/.test(query);
  if (!hasRoom) return false;
  const keywords = /状态|清洁|保洁|完成|收租|租金|押金|入住|退房|长租|出售|付款|收款|现在|怎么|多少|statut|menage|ménage|arriv|depart|paiement|payment|loyer|vente/;
  return keywords.test(query.toLowerCase());
}

export function GlobalSearch({ locale }: { locale: "zh" | "fr" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistant, setAssistant] = useState<AssistantResponse | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hasSubmittedToAssistant, setHasSubmittedToAssistant] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const showAssistant = assistant !== null || assistantLoading || hasSubmittedToAssistant;
  const showResults = !showAssistant && query.trim().length >= 2 && !searchLoading && results.length > 0;
  const showEmptySearch = !showAssistant && query.trim().length >= 2 && !searchLoading && results.length === 0;
  const isBusinessCommand = useMemo(() => looksLikeBusinessCommand(query), [query]);

  // Ctrl+K toggle
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

  // Reset on open
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    setQuery("");
    setResults([]);
    setAssistant(null);
    setSearchLoading(false);
    setAssistantLoading(false);
    setHasSubmittedToAssistant(false);
    setSelectedIdx(0);
  }, [open]);

  // Debounced search when typing
  useEffect(() => {
    if (!open || showAssistant) return;
    if (query.trim().length < 2) {
      setResults([]);
      setSearchLoading(false);
      setHasSubmittedToAssistant(false);
      return;
    }

    setSearchLoading(true);
    setHasSubmittedToAssistant(false);
    const timer = window.setTimeout(async () => {
      try {
        const response = await globalSearch(query);
        setResults(response.results);
        setSelectedIdx(0);
      } finally {
        setSearchLoading(false);
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, [open, query, showAssistant]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      setOpen(false);
      router.push(result.href);
    },
    [router],
  );

  const runAssistant = useCallback(async () => {
    const message = query.trim();
    if (!message) return;
    setAssistantLoading(true);
    setAssistant(null);
    setHasSubmittedToAssistant(true);
    setResults([]);

    try {
      const response = await fetch("/api/assistant/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, locale }),
      });
      const data = (await response.json()) as AssistantResponse;
      setAssistant(
        response.ok
          ? data
          : { error: data.error ?? (locale === "zh" ? "AI助手暂时不可用" : "Assistant indisponible") },
      );
    } catch {
      setAssistant({ error: locale === "zh" ? "AI助手连接失败" : "Connexion assistant échouée" });
    } finally {
      setAssistantLoading(false);
    }
  }, [locale, query]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    // Assistant mode: Enter sends
    if (showAssistant) {
      if (event.key === "Enter" && !assistantLoading && !assistant) {
        event.preventDefault();
        void runAssistant();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIdx((idx) => Math.min(idx + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIdx((idx) => Math.max(idx - 1, 0));
    } else if (event.key === "Enter") {
      if (results.length > 0 && results[selectedIdx]) {
        handleSelect(results[selectedIdx]);
      } else {
        event.preventDefault();
        void runAssistant();
      }
    }
  };

  const updateQuery = (value: string) => {
    setQuery(value);
    setAssistant(null);
    setHasSubmittedToAssistant(false);
  };

  if (!open) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="hidden items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/70 sm:flex"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">
            {locale === "zh" ? "搜索 / AI助手..." : "Recherche / Assistant..."}
          </span>
          <kbd className="hidden rounded-xl border border-border bg-white px-1.5 py-0 font-mono text-xs text-muted-foreground/60 lg:inline">
            Ctrl+K
          </kbd>
        </button>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center justify-center rounded-lg border border-border bg-muted/50 p-1.5 text-muted-foreground hover:bg-muted sm:hidden"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      </>
    );
  }

  const grouped = new Map<SearchResultType, SearchResult[]>();
  for (const result of results) {
    if (!grouped.has(result.type)) grouped.set(result.type, []);
    grouped.get(result.type)!.push(result);
  }

  const inputPlaceholder = locale === "zh"
    ? "搜索房号、客户、合同……或输入自然语言指令"
    : "Rechercher ou commande en langage naturel…";

  const dialog = (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[12vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative mx-4 w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* ── Input row (no tabs) ── */}
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground/60" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          {searchLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />}
          {/* Sparkle button — always visible, prominent when query looks like a command */}
          <button
            type="button"
            onClick={() => void runAssistant()}
            disabled={assistantLoading || !query.trim()}
            className={cn(
              "shrink-0 rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              isBusinessCommand
                ? "bg-sky-600 text-white hover:bg-sky-700"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            title={locale === "zh" ? "让 AI 理解这句话" : "Faire comprendre à l'IA"}
          >
            {assistantLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* ── Content area ── */}
        <div className="max-h-[430px] overflow-auto">
          {/* Initial / too short */}
          {!showAssistant && query.length < 2 && !searchLoading && (
            <div className="px-5 py-6 space-y-3">
              <p className="text-center text-sm text-muted-foreground/60">
                {locale === "zh"
                  ? "输入房号、客户名、合同号搜索，或直接说\"602现在什么状态\""
                  : "Recherchez ou dites \"statut 602\""}
              </p>
              <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <Example text="602 现在什么状态" />
                <Example text="1106 完成清洁" />
                <Example text="103 收到租金195万" />
                <Example text="503 已长租出去" />
              </div>
            </div>
          )}

          {/* Search loading */}
          {searchLoading && !showAssistant && (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground/60" />
            </div>
          )}

          {/* Empty search → prompt to use AI */}
          {showEmptySearch && (
            <div className="py-10 text-center space-y-3">
              <p className="text-sm text-muted-foreground/60">
                {locale === "zh" ? "无搜索结果" : "Aucun résultat"}
              </p>
              <button
                type="button"
                onClick={() => void runAssistant()}
                disabled={assistantLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {locale === "zh" ? "让 AI 理解这句话" : "Faire comprendre à l'IA"}
              </button>
            </div>
          )}

          {/* Grouped search results */}
          {showResults &&
            [...grouped.entries()].map(([type, items]) => (
              <div key={type}>
                <div className="bg-muted/50 px-4 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-muted-foreground/60">
                  {TYPE_LABELS[type]?.[locale] ?? type}
                </div>
                {items.map((result) => {
                  const globalIdx = results.indexOf(result);
                  const Icon = TYPE_ICONS[result.type];
                  return (
                    <button
                      key={result.id}
                      onClick={() => handleSelect(result)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                        globalIdx === selectedIdx ? "bg-accent" : "hover:bg-muted/50",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground/80">{result.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {result.subtitle && <span>{result.subtitle} · </span>}
                          {result.description}
                          {result.amount > 0 && <span className="ml-1">· {formatXof(result.amount)}</span>}
                        </p>
                      </div>
                      {result.status && (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0 text-xs font-semibold",
                            result.status === "active" ||
                              result.status === "paid" ||
                              result.status === "checked_in"
                              ? "bg-emerald-100 text-emerald-700"
                              : result.status === "overdue" || result.status === "cancelled"
                                ? "bg-red-100 text-red-700"
                                : "bg-muted text-foreground/60",
                          )}
                        >
                          {result.status}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

          {/* Assistant loading */}
          {assistantLoading && (
            <AssistantPanel assistant={null} loading locale={locale} />
          )}

          {/* Assistant response */}
          {assistant && !assistantLoading && (
            <AssistantPanel assistant={assistant} loading={false} locale={locale} />
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center gap-3 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground/60">
          {showResults && <span>↑↓ {locale === "zh" ? "导航" : "Nav"}</span>}
          <span>Enter {locale === "zh" ? (showResults ? "选择" : "AI理解") : "Valider"}</span>
          <span>Esc {locale === "zh" ? "关闭" : "Fermer"}</span>
          {query.trim().length > 0 && (
            <span className="ml-auto">
              <Sparkles className="inline h-3 w-3 mr-0.5" />
              {locale === "zh" ? "点星号让AI理解" : "Cliquez étoile pour IA"}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

function AssistantPanel({
  assistant,
  loading,
  locale,
}: {
  assistant: AssistantResponse | null;
  loading: boolean;
  locale: "zh" | "fr";
}) {
  if (loading && !assistant) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
        {locale === "zh" ? "正在理解指令……" : "Analyse en cours…"}
      </div>
    );
  }

  if (!assistant) return null;

  if (assistant.error) {
    return <div className="px-5 py-8 text-sm text-red-600">{assistant.error}</div>;
  }

  return (
    <div className="space-y-4 px-5 py-5">
      <div className="whitespace-pre-wrap rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm leading-6 text-foreground/80">
        {assistant.reply}
      </div>
      {assistant.draft && (
        <div className="rounded-xl border border-border bg-white px-4 py-3">
          <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">
            {locale === "zh" ? "识别结果" : "Brouillon"}
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {JSON.stringify(assistant.draft, null, 2)}
          </pre>
        </div>
      )}
      {assistant.requiresConfirmation && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {locale === "zh"
            ? "以上为识别结果，需要确认后才会写入数据库。目前不会自动执行任何操作。"
            : "Ceci est un brouillon. Aucune écriture n'a été effectuée."}
        </div>
      )}
    </div>
  );
}

function Example({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-muted-foreground">
      {text}
    </div>
  );
}
