import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { DataExchangeCenter } from "@/features/data-exchange";

export const dynamic = "force-dynamic";

export default async function FrenchDataExchangePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  return (
    <>
      <PageHeader title="Centre d'echange" description="Export CSV par module ou import en masse de donnees" />
      <section className="mt-8">
        <DataExchangeCenter locale="fr" userRole={user.role} />
      </section>
    </>
  );
}
