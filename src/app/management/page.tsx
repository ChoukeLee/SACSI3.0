import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { getBuildings } from "./management-data";
import { FinanceSection, UnitDataSection, QualitySection } from "./management-sections";
import { ManagementPageShell } from "./management-page-shell";
import {
  FinanceStripSkeleton, StatusOverviewSkeleton,
  RoomBoardSkeleton, QualityWidgetSkeleton,
} from "./management-skeletons";
import type { BuildingRow } from "@/types/database";


export default async function ManagementPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Only fetch buildings â€” all heavy data loads inside Suspense boundaries
  const buildings = (await getBuildings()) as BuildingRow[];
  const t = dictionaries.zh.management;

  return (
    <ManagementPageShell buildings={buildings} locale="zh" t={t}>
      {/* Finance strip â€” loads independently */}
      <Suspense fallback={<FinanceStripSkeleton />}>
        <FinanceSection locale="zh" t={t} buildings={buildings} />
      </Suspense>

      {/* Unit data: building selector + status + risk alerts + room board */}
      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <StatusOverviewSkeleton />
            <RoomBoardSkeleton />
          </div>
        }
      >
        <UnitDataSection buildings={buildings} locale="zh" t={t} />
      </Suspense>

      {/* Quality widget â€” loads independently */}
      <Suspense fallback={<QualityWidgetSkeleton />}>
        <QualitySection locale="zh" userRole={user.role} />
      </Suspense>
    </ManagementPageShell>
  );
}

