"use client";

import type { Locale, ManagementDict } from "@/lib/i18n";
import type { BuildingRow } from "@/types/database";
import { OperationalPage } from "@/components/ui/operational";

export function ManagementPageShell({
  buildings, locale, t, children, projectName, description,
}: {
  buildings: BuildingRow[]; locale: Locale; t: ManagementDict; children: React.ReactNode;
  projectName?: string;
  description?: string;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const buildingCount = buildings.filter((building) => building.is_active).length;

  return (
    <OperationalPage
      eyebrow={locale === "zh" ? "今日经营" : "Activité du jour"}
      title={projectName ?? (locale === "zh" ? "首页" : t.allBuildings)}
      description={description ?? (locale === "zh" ? "财务、房态和楼栋经营信息" : "Finance, occupation et immeubles")}
      action={
        <>
            <span className="rounded-lg border border-border bg-muted/70 px-3 py-1.5 text-xs font-medium text-muted-foreground tabular-nums">
              {new Date(todayStr).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { weekday: "long", month: "short", day: "numeric" })}
            </span>
            <span className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-xs tabular-nums">
              {buildingCount} {locale === "zh" ? "栋在管" : "actifs"}
            </span>
        </>
      }
    >
      {children}
    </OperationalPage>
  );
}
