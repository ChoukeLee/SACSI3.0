import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  UnitWorkbenchWorkspace,
  UnitWorkbenchSkeleton,
} from "@/features/units/unit-workbench-workspace";
import type { UnitWorkbenchSearch } from "@/features/units/unit-workbench-model";
import { redirectLegacyCimac } from "@/features/cimac/cimac-legacy-redirect";

export default async function FrenchUnitsPage({
  searchParams,
}: {
  searchParams: Promise<UnitWorkbenchSearch>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");
  const params = await searchParams;
  await redirectLegacyCimac("units", params, "fr");

  return (
    <Suspense fallback={<UnitWorkbenchSkeleton locale="fr" />}>
      <UnitWorkbenchWorkspace
        input={params}
        locale="fr"
        canEdit={user.role === "admin"}
        viewerId={user.id}
      />
    </Suspense>
  );
}
