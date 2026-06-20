"use client";

import type { Locale } from "@/lib/i18n";

/**
 * Lightweight skeleton shown while the daily calendar JS bundle loads.
 * Matches the calendar's visual structure without importing its heavy code.
 */
export function CalendarSkeleton({ locale }: { locale: Locale }) {
  const t = locale === "fr"
    ? { timeline: "Planning…", subtitle: "Chargement du calendrier…" }
    : { timeline: "预订时间轴", subtitle: "正在加载日历…" };

  return (
    <section className="-mx-2 xl:-mx-4">
      <div className="relative isolate space-y-5 animate-fade-in">
        {/* Stats placeholder */}
        <section className="rounded-xl border border-border bg-card shadow-card">
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <div className="h-5 w-20 animate-pulse rounded-lg bg-muted/60" />
            <div className="h-3 w-48 animate-pulse rounded-full bg-muted/40" />
          </div>
          <div className="grid gap-3 bg-card px-4 py-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/30" />
            ))}
          </div>
          <div className="grid gap-3 border-t border-border bg-card px-4 py-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/30" />
            ))}
          </div>
        </section>

        {/* Timeline placeholder */}
        <section className="rounded-xl border border-border bg-card shadow-card">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <div>
              <div className="h-5 w-28 animate-pulse rounded-lg bg-muted/60" />
              <div className="mt-1 h-3 w-56 animate-pulse rounded-full bg-muted/40" />
            </div>
          </div>
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <div className="h-9 w-48 animate-pulse rounded-lg bg-muted/30" />
            <div className="h-9 w-64 animate-pulse rounded-lg bg-muted/30" />
          </div>
          <div className="min-h-[360px] flex items-center justify-center">
            <p className="text-sm text-muted-foreground animate-pulse">{t.subtitle}</p>
          </div>
        </section>
      </div>
    </section>
  );
}
