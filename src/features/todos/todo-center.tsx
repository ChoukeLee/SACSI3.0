"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, Calendar, Clock } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { FilterBar, FilterGroup, SegmentedControl } from "@/components/ui/operational";
import { SearchInput } from "@/components/ui/search-input";
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

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[{ key:"total", label:zh?"全部待办":"Total", value:String(todos.length), dot:"bg-accentBlue-500" },
          { key:"high", label:zh?"紧急":"Urgent", value:String(highTodos.length), dot:"bg-accentRed-500" },
          { key:"today", label:zh?"今日":"Aujourd'hui", value:String(todayTodos.length), dot:"bg-accentAmber-500" },
          { key:"overdue", label:zh?"逾期":"Retard", value:String(overdueTodos.length), dot:"bg-accentRed-500" },
        ].map(b => (
          <div key={b.key} className="flex min-h-[76px] flex-col rounded-xl border border-border bg-card p-3 text-card-foreground shadow-card transition-shadow duration-200">
            <div className="flex min-w-0 items-center justify-between gap-3 pb-2">
              <p className="min-w-0 truncate text-sm font-medium leading-tight tracking-tight text-foreground">{b.label}</p>
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", b.dot)} />
            </div>
            <p className="text-lg font-semibold leading-none tabular-nums text-foreground">{b.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <FilterBar meta={<span className="tabular-nums">{filtered.length} {zh ? "条" : "lignes"}</span>}>
        <FilterGroup label={zh ? "模块" : "Module"}>
          <SegmentedControl
            value={sourceFilter}
            onChange={setSourceFilter}
            ariaLabel={zh ? "模块筛选" : "Filtre module"}
            items={[
              { value: "all", label: zh ? "全部" : "Tous" },
              ...(Object.entries(sourceLabels) as [TodoSource, string][]).map(([value, label]) => ({ value, label })),
            ]}
          />
        </FilterGroup>
        <FilterGroup label={zh ? "优先级" : "Priorite"}>
          <SegmentedControl
            value={priorityFilter}
            onChange={setPriorityFilter}
            ariaLabel={zh ? "优先级筛选" : "Filtre priorite"}
            items={[
              { value: "all", label: zh ? "全部" : "Tous" },
              { value: "high", label: zh ? "紧急" : "Urgent" },
              { value: "medium", label: zh ? "一般" : "Moyen" },
              { value: "low", label: zh ? "低" : "Bas" },
            ]}
          />
        </FilterGroup>
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={zh ? "搜索房号/客户..." : "Rechercher..."}
          className="w-full sm:w-[280px]"
        />
      </FilterBar>

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
                <p className="truncate text-sm font-medium">{todo.title}</p>
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
