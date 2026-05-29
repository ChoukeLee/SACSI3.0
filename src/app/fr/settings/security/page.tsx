import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { SecurityCenter } from "@/features/security";

export const dynamic = "force-dynamic";

export default async function FrenchSecurityPage() {
  const user = await getCurrentUser();
  if (!user || !["admin", "boss"].includes(user.role)) redirect("/");

  return (
    <>
      <PageHeader title="Sécurité" />
      <section className="mt-8"><SecurityCenter locale="fr" /></section>
    </>
  );
}
