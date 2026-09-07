import { redirect } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { AiWorkbenchView } from "@/features/ai-workbench/workbench-view";
import { getOrCreateActiveConversation, loadConversationHistory } from "@/features/ai-workbench/conversation-service";

export default async function FrAssistantPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "rental_sales"].includes(user.role)) redirect("/");
  const conversation = await getOrCreateActiveConversation("fr");
  const history = await loadConversationHistory(conversation.id);
  return <AiWorkbenchView locale="fr" conversationId={conversation.id} initialHistory={history} canRecordFinance={hasPermission(user, "finance:write")} />;
}
