"use client";

import type { Locale, ManagementDict } from "@/lib/i18n";
import type { BuildingRow } from "@/types/database";

export function ManagementPageShell({
  buildings, locale, t, children,
}: {
  buildings: BuildingRow[]; locale: Locale; t: ManagementDict; children: React.ReactNode;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const buildingCount = buildings.filter((building) => building.is_active).length;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Chrome: title + date (renders immediately — buildings is lightweight) ── */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-card px-5 py-4 shadow-card sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
            {locale === "zh" ? "经营驾驶舱" : "Tableau de bord"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {t.allBuildings}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-border bg-muted/70 px-3 py-1.5 text-xs font-medium text-muted-foreground tabular-nums">
              {new Date(todayStr).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { weekday: "long", month: "short", day: "numeric" })}
            </span>
            <span className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm tabular-nums">
              {buildingCount} {locale === "zh" ? "栋在管" : "actifs"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Content sections (rendered by server as children) ── */}
      {children}
    </div>
  );
}
