"use client";

import { useState } from "react";
import { Bell, X, Check } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  due_at: string | null;
}

interface NotificationBellProps {
  notifications: NotificationRow[];
  locale: Locale;
}

export function NotificationBell({ notifications, locale }: NotificationBellProps) {
  const t = dictionaries[locale].shell.notifications;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(notifications);

  const unread = items.filter((n) => !n.read_at).length;

  const markRead = (id: string) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    );
  };

  const markAllRead = () => {
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-panel">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h4 className="text-sm font-bold text-slate-950">
                {t.title}
                {unread > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-brand-red-500">({unread} {t.unread})</span>
                )}
              </h4>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    onClick={markAllRead}
                    className="rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Check className="mr-0.5 inline h-3 w-3" />
                    {t.markAllRead}
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="max-h-80 overflow-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">{t.empty}</p>
              ) : (
                <ul className="divide-y divide-brand-warm-400">
                  {items.map((n) => (
                    <li
                      key={n.id}
                      className={cn(
                        "px-4 py-3 transition cursor-pointer hover:bg-slate-50",
                        !n.read_at && "bg-brand-orange-50/50"
                      )}
                      onClick={() => markRead(n.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-sm", !n.read_at && "font-semibold text-slate-950", n.read_at && "text-slate-600")}>
                          {n.title}
                        </p>
                        {!n.read_at && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-brand-orange mt-1.5" />
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {new Date(n.created_at).toLocaleDateString(
                          locale === "fr" ? "fr-FR" : "zh-CN",
                          { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
