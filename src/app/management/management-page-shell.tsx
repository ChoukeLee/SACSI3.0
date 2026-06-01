"use client";

import type { Locale, ManagementDict } from "@/lib/i18n";
import type { BuildingRow } from "@/types/database";

export function ManagementPageShell({
  buildings, locale, t, children,
}: {
  buildings: BuildingRow[]; locale: Locale; t: ManagementDict; children: React.ReactNode;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Chrome: title + date (renders immediately — buildings is lightweight) ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
            {locale === "zh" ? "经营驾驶舱" : "Tableau de bord"}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            {t.allBuildings}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {new Date(todayStr).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { weekday: "long", month: "short", day: "numeric" })}
          </span>
        </div>
      </div>

      {/* ── Content sections (rendered by server as children) ── */}
      {children}
    </div>
  );
}
