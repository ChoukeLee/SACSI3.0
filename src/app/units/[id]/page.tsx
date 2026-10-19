import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UnitProfileView } from "@/features/units/unit-profile-view";
import { fetchUnitProfile } from "@/features/units/unit-profile-service";

export const dynamic = "force-dynamic";

export default async function UnitProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "rental_sales"].includes(user.role)) redirect("/");
  const profile = await fetchUnitProfile(id);
  if (!profile) notFound();
  const query = await searchParams;
  return (
    <UnitProfileView
      data={profile}
      locale="zh"
      returnTo={typeof query?.returnTo === "string" ? query.returnTo : undefined}
    />
  );
}
