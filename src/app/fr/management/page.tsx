import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { getBuildings } from "@/app/management/management-data";
import { FinanceSection, UnitDataSection, QualitySection } from "@/app/management/management-sections";
import { ManagementPageShell } from "@/app/management/management-page-shell";
import {
  FinanceStripSkeleton, StatusOverviewSkeleton,
  RoomBoardSkeleton, QualityWidgetSkeleton,
} from "@/app/management/management-skeletons";
import type { BuildingRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchManagementPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Only fetch buildings — all heavy data loads inside Suspense boundaries
  const buildings = (await getBuildings()) as BuildingRow[];
  const t = dictionaries.fr.management;

  return (
    <ManagementPageShell buildings={buildings} locale="fr" t={t}>
      {/* Finance strip — loads independently */}
      <Suspense fallback={<FinanceStripSkeleton />}>
        <FinanceSection locale="fr" t={t} buildings={buildings} />
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
        <UnitDataSection buildings={buildings} locale="fr" t={t} />
      </Suspense>

      {/* Quality widget — loads independently */}
      <Suspense fallback={<QualityWidgetSkeleton />}>
        <QualitySection locale="fr" userRole={user.role} />
      </Suspense>
    </ManagementPageShell>
  );
}
