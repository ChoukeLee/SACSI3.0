import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AssistantOperationsCenter } from "@/features/assistant-operations/assistant-operations-center";

export default async function AssistantFrPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "rental_sales") redirect("/fr");

  return <AssistantOperationsCenter locale="fr" userRole={user.role} />;
}
