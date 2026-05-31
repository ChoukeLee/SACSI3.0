import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BulkActionCenter } from "@/features/bulk-actions";

export const revalidate = 60;

export default async function FrenchBulkActionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  return <BulkActionCenter locale="fr" userRole={user.role} />;
}
