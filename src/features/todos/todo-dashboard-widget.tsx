"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, Calendar, Clock } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import type { TodoItem } from "./todo-types";

interface Props {
  todos: TodoItem[];
  locale: Locale;
  maxItems?: number;
}

export function TodoDashboardWidget({ todos, locale, maxItems = 6 }: Props) {
  const sorted = useMemo(() => {
    const priorityScore = (t: TodoItem) => t.priority === "high" ? 3 : t.priority === "medium" ? 2 : 1;
    return [...todos].sort((a, b) => {
      const scoreDiff = priorityScore(b) - priorityScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.dueDate.localeCompare(b.dueDate);
    }).slice(0, maxItems);
  }, [todos, maxItems]);

  if (todos.length === 0) {
    return (
      <div className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card text-center">
        <Bell className="mx-auto h-6 w-6 text-brand-ink-200 mb-2" />
        <p className="text-sm text-brand-ink-300">{locale === "zh" ? "今日暂无待办" : "Aucune tache"}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-warm-400 bg-white shadow-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-brand-warm-200 bg-brand-warm-50/50">
        <h3 className="text-sm font-bold text-brand-ink-900 flex items-center gap-2">
          <Bell className="h-4 w-4 text-brand-orange" />
          {locale === "zh" ? "今日待办" : "Aujourd'hui"}
        </h3>
        <span className="text-xs text-brand-ink-400">
          {todos.length} {locale === "zh" ? "条" : "lignes"}
        </span>
      </div>
      <div className="divide-y divide-brand-warm-200">
        {sorted.map(todo => (
          <Link
            key={todo.id}
            href={routeFor(locale, todo.href)}
            className={cn(
              "flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-brand-warm-50",
              todo.priority === "high" && "bg-brand-red-50/20",
            )}
          >
            {todo.priority === "high" ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-brand-red-500" />
            ) : todo.dueDate === new Date().toISOString().slice(0, 10) ? (
              <Clock className="h-4 w-4 shrink-0 text-brand-orange" />
            ) : (
              <Calendar className="h-4 w-4 shrink-0 text-brand-ink-300" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-brand-ink-800 truncate">{todo.title}</p>
              <p className="text-[10px] text-brand-ink-400 truncate">
                {todo.unitLabel && <span>{todo.unitLabel} · </span>}
                {todo.customerName}
                {todo.amount > 0 && <span> · {formatXof(todo.amount)}</span>}
              </p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-ink-200" />
          </Link>
        ))}
      </div>
      {todos.length > maxItems && (
        <div className="px-5 py-2 border-t border-brand-warm-200 bg-brand-warm-50/30">
          <Link
            href={routeFor(locale, "/todos")}
            className="text-xs font-medium text-brand-orange hover:underline flex items-center gap-1"
          >
            {locale === "zh" ? "查看全部" : "Voir tout"} ({todos.length})
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}
