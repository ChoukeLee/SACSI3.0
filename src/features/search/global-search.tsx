"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X, User, Building2, BedDouble, Home, CreditCard, Receipt, DollarSign, FileText, Loader2 } from "lucide-react";
import { cn, formatXof } from "@/lib/utils";
import { globalSearch } from "./search-service";
import type { SearchResult, SearchResultType } from "./search-types";

const TYPE_ICONS: Record<SearchResultType, typeof Search> = {
  customer: User, unit: Building2, daily_booking: BedDouble,
  lease: Home, sale: CreditCard, receivable: Receipt,
  payment: DollarSign, document: FileText,
};
const TYPE_LABELS: Record<SearchResultType, Record<string, string>> = {
  customer: { zh: "客户", fr: "Client" },
  unit: { zh: "房源", fr: "Logement" },
  daily_booking: { zh: "日租", fr: "Jour" },
  lease: { zh: "长租", fr: "Location" },
  sale: { zh: "出售", fr: "Vente" },
  receivable: { zh: "应收", fr: "Creance" },
  payment: { zh: "收款", fr: "Paiement" },
  document: { zh: "单据", fr: "Document" },
};

export function GlobalSearch({ locale }: { locale: "zh" | "fr" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setQuery("");
      setResults([]);
      setSelectedIdx(0);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await globalSearch(query);
      setResults(res.results);
      setSelectedIdx(0);
      setLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = useCallback((r: SearchResult) => {
    setOpen(false);
    router.push(r.href);
  }, [router]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[selectedIdx]) { handleSelect(results[selectedIdx]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  if (!open) return (
    <>
      {/* Desktop search button */}
      <button
        onClick={() => setOpen(true)}
        className="hidden sm:flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">{locale === "zh" ? "搜索..." : "Rechercher..."}</span>
        <kbd className="hidden lg:inline rounded-xl border border-slate-200 bg-white px-1.5 py-0 text-[10px] font-mono text-slate-400">Ctrl+K</kbd>
      </button>
      {/* Mobile search icon */}
      <button
        onClick={() => setOpen(true)}
        className="flex sm:hidden items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-slate-500 hover:bg-slate-100"
      >
        <Search className="h-4 w-4" />
      </button>
    </>
  );

  const grouped = new Map<string, SearchResult[]>();
  for (const r of results) {
    const key = r.type;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-brand-neutral-200">
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={locale === "zh" ? "搜索客户、房源、合同、应收..." : "Rechercher client, chambre, contrat..."}
            className="flex-1 text-sm text-slate-950 placeholder:text-slate-400 bg-transparent outline-none"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-auto">
          {query.length < 2 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              {locale === "zh" ? "输入至少 2 个字符开始搜索" : "Tapez au moins 2 caracteres"}
            </div>
          ) : loading ? (
            <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
          ) : results.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              {locale === "zh" ? "无搜索结果" : "Aucun resultat"}
            </div>
          ) : (
            [...grouped.entries()].map(([type, items]) => (
              <div key={type}>
                <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 bg-slate-50">
                  {TYPE_LABELS[type as SearchResultType]?.[locale] ?? type}
                </div>
                {items.map((r, i) => {
                  const globalIdx = results.indexOf(r);
                  const Icon = TYPE_ICONS[r.type];
                  return (
                    <button
                      key={r.id}
                      onClick={() => handleSelect(r)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                        globalIdx === selectedIdx ? "bg-brand-orange-50" : "hover:bg-slate-50",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{r.title}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {r.subtitle && <span>{r.subtitle} · </span>}
                          {r.description}
                          {r.amount > 0 && <span className="ml-1">· {formatXof(r.amount)}</span>}
                        </p>
                      </div>
                      {r.status && (
                        <span className={cn("shrink-0 rounded-full px-1.5 py-0 text-[9px] font-semibold",
                          r.status === "active" || r.status === "paid" || r.status === "checked_in" ? "bg-brand-green-100 text-brand-green-700" :
                          r.status === "overdue" || r.status === "cancelled" ? "bg-brand-red-100 text-brand-red-700" :
                          "bg-slate-100 text-slate-600"
                        )}>{r.status}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-brand-neutral-200 text-[10px] text-slate-400">
          <span>↑↓ {locale === "zh" ? "导航" : "Nav"}</span>
          <span>↵ {locale === "zh" ? "选择" : "Sel"}</span>
          <span>Esc {locale === "zh" ? "关闭" : "Fermer"}</span>
        </div>
      </div>
    </div>
  );
}
