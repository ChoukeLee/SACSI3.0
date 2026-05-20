import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CustomerProfileView } from "@/features/customers/customer-profile-view";
import { fetchCustomerProfile } from "@/features/customers/customer-profile-service";

export const dynamic = "force-dynamic";

export default async function FrenchCustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  const profile = await fetchCustomerProfile(id);
  if (!profile) notFound();

  return (
    <div className="min-h-screen bg-brand-warm-50 py-6 px-4">
      <CustomerProfileView data={profile} locale="fr" userRole={user.role} />
    </div>
  );
}
