"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, Calendar, Clock, Filter, Search } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import type { TodoItem, TodoSource, TodoPriority, TodoType } from "./todo-types";

interface Props {
  todos: TodoItem[];
  locale: Locale;
}

const PRIORITY_DOT: Record<TodoPriority, string> = {
  high: "bg-brand-red-500",
  medium: "bg-brand-amber-500",
  low: "bg-brand-sky-400",
};

const SOURCE_LABELS: Record<Locale, Record<TodoSource, string>> = {
  zh: { daily: "日租", lease: "长租", sale: "出售", finance: "财务", system: "系统" },
  fr: { daily: "Jour", lease: "Location", sale: "Vente", finance: "Finance", system: "Systeme" },
};

export function TodoCenter({ todos, locale }: Props) {
  const sourceLabels = SOURCE_LABELS[locale];

  const [sourceFilter, setSourceFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return todos.filter(t => {
      if (sourceFilter !== "all" && t.source !== sourceFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const haystack = [t.title, t.description, t.unitLabel, t.customerName].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [todos, sourceFilter, priorityFilter, search]);

  const todayTodos = useMemo(() => todos.filter(t => t.dueDate === new Date().toISOString().slice(0, 10)), [todos]);
  const highTodos = useMemo(() => todos.filter(t => t.priority === "high"), [todos]);
  const overdueTodos = useMemo(() => {
    const t = new Date().toISOString().slice(0, 10);
    return todos.filter(todo => todo.dueDate < t && todo.status === "open");
  }, [todos]);

  const filterBtn = "rounded-lg border border-brand-warm-400 px-2.5 py-1 text-[11px] font-medium transition-all duration-fast bg-white";

  const priorityBadge = (p: TodoPriority) => {
    const s: Record<TodoPriority, string> = {
      high: "bg-brand-red-100 text-brand-red-700",
      medium: "bg-brand-amber-100 text-amber-700",
      low: "bg-brand-sky-100 text-brand-sky-700",
    };
    const l: Record<Locale, Record<TodoPriority, string>> = {
      zh: { high: "紧急", medium: "一般", low: "低" },
      fr: { high: "Urgent", medium: "Moyen", low: "Bas" },
    };
    return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", s[p])}>{l[locale][p]}</span>;
  };

  return (
    <div>
      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatPill label={locale === "zh" ? "全部待办" : "Total"} value={todos.length} accent="ink" />
        <StatPill label={locale === "zh" ? "紧急" : "Urgent"} value={highTodos.length} accent="red" />
        <StatPill label={locale === "zh" ? "今日" : "Aujourd'hui"} value={todayTodos.length} accent="orange" />
        <StatPill label={locale === "zh" ? "逾期" : "Retard"} value={overdueTodos.length} accent="red" />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className={filterBtn}>
          <option value="all">{locale === "zh" ? "模块" : "Module"}: {locale === "zh" ? "全部" : "Tous"}</option>
          {(Object.entries(sourceLabels) as [TodoSource, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className={filterBtn}>
          <option value="all">{locale === "zh" ? "优先级" : "Priorite"}: {locale === "zh" ? "全部" : "Tous"}</option>
          <option value="high">{locale === "zh" ? "紧急" : "Urgent"}</option>
          <option value="medium">{locale === "zh" ? "一般" : "Moyen"}</option>
          <option value="low">{locale === "zh" ? "低" : "Bas"}</option>
        </select>
        <div className="relative flex-1 min-w-[160px] max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-brand-ink-300" />
          <input type="text" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={locale === "zh" ? "搜索房号/客户..." : "Rechercher..."}
            className="w-full rounded-lg border border-brand-warm-400 pl-8 pr-3 py-1.5 text-xs text-brand-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30" />
        </div>
        <span className="text-xs text-brand-ink-300 ml-auto">{filtered.length} {locale === "zh" ? "条" : "lignes"}</span>
      </div>

      {/* Todo list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-brand-warm-400 bg-white py-16 text-center text-sm text-brand-ink-300 shadow-natural">
          <Bell className="mx-auto h-8 w-8 mb-3 text-brand-ink-200" />
          {locale === "zh" ? "暂无待办事项" : "Aucune tache"}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(todo => (
            <Link
              key={todo.id}
              href={routeFor(locale, todo.href)}
              className="flex items-center gap-4 rounded-lg border border-brand-warm-400 bg-white px-4 py-3 shadow-natural transition-all hover:-translate-y-0.5 hover:border-brand-orange-400"
            >
              <div className={cn("shrink-0 h-3 w-3 rounded-full", PRIORITY_DOT[todo.priority] || PRIORITY_DOT.medium)} />
              <div className="shrink-0">
                {todo.priority === "high" ? (
                  <AlertTriangle className="h-5 w-5 text-brand-red-500" />
                ) : todo.dueDate === new Date().toISOString().slice(0, 10) ? (
                  <Clock className="h-5 w-5 text-brand-orange" />
                ) : (
                  <Calendar className="h-5 w-5 text-brand-ink-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium rounded bg-brand-warm-100 px-1.5 py-0 text-brand-ink-500">
                    {sourceLabels[todo.source]}
                  </span>
                  {priorityBadge(todo.priority)}
                </div>
                <p className="text-sm font-semibold text-brand-ink-900 truncate">{todo.title}</p>
                <p className="text-xs text-brand-ink-400 mt-0.5 truncate">
                  {todo.unitLabel && <span className="font-mono mr-2">{todo.unitLabel}</span>}
                  {todo.customerName}
                  {todo.amount > 0 && <span className="ml-2 font-medium text-brand-ink-600">{formatXof(todo.amount)}</span>}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs text-brand-ink-300">
                <div>{todo.dueDate}</div>
                <ArrowRight className="h-4 w-4 ml-auto mt-1 text-brand-ink-200" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: number; accent: string }) {
  const colors: Record<string, string> = {
    ink: "bg-brand-ink-700",
    red: "bg-brand-red-500",
    orange: "bg-brand-orange",
  };
  return (
    <div className="rounded-lg border border-brand-warm-400 bg-white shadow-natural overflow-hidden">
      <div className={cn("h-[3px]", colors[accent] ?? "bg-brand-ink-700")} />
      <div className="px-3 py-2">
        <p className="text-[10px] text-brand-ink-300">{label}</p>
        <p className="text-lg font-bold tabular-nums text-brand-ink-900">{value}</p>
      </div>
    </div>
  );
}
