import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SecurityCenter } from "@/features/security";

export const revalidate = 60;

export default async function FrenchSecurityPage() {
  const user = await getCurrentUser();
  if (!user || !["admin", "boss"].includes(user.role)) redirect("/");

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Sécurité</h1>
      <section className="mt-8"><SecurityCenter locale="fr" /></section>
    </>
  );
}
