import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuditWorkbenchPage } from "@/features/settings/audit-workbench-page";
import { AuditWorkbenchSkeleton } from "@/features/settings/audit-workbench";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FrenchAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss"].includes(user.role)) redirect("/");

  return (
    <Suspense fallback={<AuditWorkbenchSkeleton locale="fr" />}>
      <AuditWorkbenchPage
        params={await searchParams}
        locale="fr"
        viewerKey={`${user.id}:${user.role}`}
      />
    </Suspense>
  );
}
