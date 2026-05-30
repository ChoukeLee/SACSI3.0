import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BulkActionCenter } from "@/features/bulk-actions";

export const dynamic = "force-dynamic";

export default async function BulkActionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance", "front_desk"].includes(user.role)) redirect("/");

  return <BulkActionCenter locale="zh" userRole={user.role} />;
}
