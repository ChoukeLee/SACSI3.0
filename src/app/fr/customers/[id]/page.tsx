import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CustomerProfileView } from "@/features/customers/customer-profile-view";
import { fetchCustomerProfile } from "@/features/customers/customer-profile-service";
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";

export const dynamic = "force-dynamic";

export default async function FrenchCustomerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "rental_sales"].includes(user.role)) redirect("/");

  const profile = await fetchCustomerProfile(id);
  if (!profile) notFound();

  return (
    <CustomerProfileView
      data={profile}
      locale="fr"
      userRole={user.role}
      returnTo={safeWorkbenchReturnTo((await searchParams).returnTo)}
    />
  );
}
