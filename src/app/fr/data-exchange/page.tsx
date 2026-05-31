import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DataExchangeCenter } from "@/features/data-exchange";

export const revalidate = 60;

export default async function FrenchDataExchangePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  return <DataExchangeCenter locale="fr" userRole={user.role} />;
}
