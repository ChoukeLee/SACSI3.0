import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CustomerProfileView } from "@/features/customers/customer-profile-view";
import { fetchCustomerProfile } from "@/features/customers/customer-profile-service";

export const dynamic = "force-dynamic";

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  const profile = await fetchCustomerProfile(id);
  if (!profile) notFound();

  return (
    <CustomerProfileView data={profile} locale="zh" userRole={user.role} />
  );
}
