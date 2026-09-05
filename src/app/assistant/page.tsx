import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AiWorkbenchView } from "@/features/ai-workbench/workbench-view";

export default async function AssistantPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "rental_sales"].includes(user.role)) redirect("/");
  return <AiWorkbenchView locale="zh" />;
}
