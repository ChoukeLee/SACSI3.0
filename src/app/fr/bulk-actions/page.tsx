import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { BulkActionCenter } from "@/features/bulk-actions";

export const dynamic = "force-dynamic";

export default async function FrenchBulkActionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  return (
    <>
      <PageHeader title="Actions en masse" description="Traitement par lots : generer creances, confirmer paiements, modifier statuts, exporter listes" />
      <section className="mt-8">
        <BulkActionCenter locale="fr" userRole={user.role} />
      </section>
    </>
  );
}
