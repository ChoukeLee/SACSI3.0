import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { CustomerList } from "@/features/customers";
import type { CustomerRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss"].includes(user.role)) redirect("/");
  const t = dictionaries.zh.customers;
  const supabase = await createClient();

  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .order("name");

  if (error) console.error("Failed to fetch customers:", error);

  return (
      <>

<><PageHeader title={t.title} description={t.description} />
      <CustomerList customers={(customers as CustomerRow[]) ?? []} locale="zh" />

      </>
</>);
}
