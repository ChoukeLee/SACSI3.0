"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, Calendar, Clock, Search } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import type { TodoItem, TodoSource, TodoPriority } from "./todo-types";

interface Props {
  todos: TodoItem[];
  locale: Locale;
}

const SOURCE_LABELS: Record<Locale, Record<TodoSource, string>> = {
  zh: { daily: "日租", lease: "长租", sale: "出售", finance: "财务", system: "系统" },
  fr: { daily: "Jour", lease: "Location", sale: "Vente", finance: "Finance", system: "Système" },
};

const priorityTone: Record<TodoPriority, "destructive" | "warning" | "secondary"> = {
  high: "destructive", medium: "warning", low: "secondary",
};

const priorityLabels: Record<Locale, Record<TodoPriority, string>> = {
  zh: { high: "紧急", medium: "一般", low: "低" },
  fr: { high: "Urgent", medium: "Moyen", low: "Bas" },
};

export function TodoCenter({ todos, locale }: Props) {
  const sourceLabels = SOURCE_LABELS[locale];
  const priLabels = priorityLabels[locale];

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

  const zh = locale === "zh";

  const filterBtn = "h-9 rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[{ key:"total", label:zh?"全部待办":"Total", value:String(todos.length), dot:"bg-accentBlue-500" },
          { key:"high", label:zh?"紧急":"Urgent", value:String(highTodos.length), dot:"bg-accentRed-500" },
          { key:"today", label:zh?"今日":"Aujourd'hui", value:String(todayTodos.length), dot:"bg-accentAmber-500" },
          { key:"overdue", label:zh?"逾期":"Retard", value:String(overdueTodos.length), dot:"bg-accentRed-500" },
        ].map(b => (
          <div key={b.key} className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
            <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", b.dot)} />
            <div className="min-w-0"><p className="text-xl font-bold tracking-tight tabular-nums leading-none">{b.value}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{b.label}</p></div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className={filterBtn}>
          <option value="all">{zh ? "模块" : "Module"}: {zh ? "全部" : "Tous"}</option>
          {(Object.entries(sourceLabels) as [TodoSource, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className={filterBtn}>
          <option value="all">{zh ? "优先级" : "Priorité"}: {zh ? "全部" : "Tous"}</option>
          <option value="high">{zh ? "紧急" : "Urgent"}</option>
          <option value="medium">{zh ? "一般" : "Moyen"}</option>
          <option value="low">{zh ? "低" : "Bas"}</option>
        </select>
        <div className="relative flex-1 min-w-[160px] max-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input type="text" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={zh ? "搜索房号/客户..." : "Rechercher..."}
            className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <span className="text-sm text-muted-foreground ml-auto tabular-nums">{filtered.length} {zh ? "条" : "lignes"}</span>
      </div>

      {/* Todo list */}
      {filtered.length === 0 ? (
        <EmptyState icon={<Bell className="h-10 w-10" />} title={zh ? "暂无待办事项" : "Aucune tâche"} />
      ) : (
        <div className="space-y-2">
          {filtered.map(todo => (
            <Link
              key={todo.id}
              href={routeFor(locale, todo.href)}
              className="flex items-center gap-4 rounded-xl border bg-card px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className={cn("shrink-0 h-3 w-3 rounded-full", todo.priority === "high" ? "bg-rose-500" : todo.priority === "medium" ? "bg-amber-500" : "bg-cyan-400")} />
              <div className="shrink-0">
                {todo.priority === "high" ? (
                  <AlertTriangle className="h-5 w-5 text-rose-500" />
                ) : todo.dueDate === new Date().toISOString().slice(0, 10) ? (
                  <Clock className="h-5 w-5 text-primary" />
                ) : (
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge variant="secondary" className="text-[10px]">
                    {sourceLabels[todo.source]}
                  </Badge>
                  <Badge variant={priorityTone[todo.priority]} className="text-[10px]">{priLabels[todo.priority]}</Badge>
                </div>
                <p className="text-sm font-bold truncate">{todo.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {todo.unitLabel && <span className="font-mono mr-2">{todo.unitLabel}</span>}
                  {todo.customerName}
                  {todo.amount > 0 && <span className="ml-2 font-medium">{formatXof(todo.amount)}</span>}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs font-semibold text-muted-foreground">
                <div>{todo.dueDate}</div>
                <ArrowRight className="h-4 w-4 ml-auto mt-1 text-muted-foreground/50" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
