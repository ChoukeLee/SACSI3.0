import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UnitProfileView } from "@/features/units/unit-profile-view";
import { fetchUnitProfile } from "@/features/units/unit-profile-service";

export const dynamic = "force-dynamic";

export default async function UnitProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  const profile = await fetchUnitProfile(id);
  if (!profile) notFound();

  return (
    <div className="min-h-screen bg-brand-warm-50 py-6 px-4">
      <UnitProfileView data={profile} locale="zh" userRole={user.role} />
    </div>
  );
}
