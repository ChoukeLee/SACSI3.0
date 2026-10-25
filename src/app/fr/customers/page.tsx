import { Suspense } from "react";
import { redirect } from "next/navigation";
import { canAccessPage, getCurrentUser, hasPermission } from "@/lib/auth";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import { CustomerDirectoryWorkspace } from "@/features/customers/customer-directory-workspace";
import { redirectLegacyCimac } from "@/features/cimac/cimac-legacy-redirect";

export default async function FrenchCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/fr/login");
  if (!canAccessPage(user.role, "customers")) redirect("/fr");
  const params = await searchParams;
  await redirectLegacyCimac("customers", params, "fr");
  return (
    <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
      <CustomerDirectoryWorkspace
        searchParams={params}
        locale="fr"
        canEdit={hasPermission(user, "customers:write")}
      />
    </Suspense>
  );
}
