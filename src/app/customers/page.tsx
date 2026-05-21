import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
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

  const [customersRes, leaseRes, saleRes, dailyRes] = await Promise.all([
    supabase.from("customers").select("*").order("name"),
    supabase.from("lease_contracts").select("customer_id").limit(1000),
    supabase.from("sale_contracts").select("customer_id").limit(1000),
    supabase.from("daily_bookings").select("customer_id").limit(1000),
  ]);

  if (customersRes.error) console.error("Failed to fetch customers:", customersRes.error);

  const customerSegments = {
    leaseCustomerIds: [...new Set((leaseRes.data ?? []).map((row) => row.customer_id).filter(Boolean))],
    saleCustomerIds: [...new Set((saleRes.data ?? []).map((row) => row.customer_id).filter(Boolean))],
    dailyCustomerIds: [...new Set((dailyRes.data ?? []).map((row) => row.customer_id).filter(Boolean))],
  };

  return (
    <>
      <CustomerList customers={(customersRes.data as CustomerRow[]) ?? []} customerSegments={customerSegments} locale="zh" />
    </>
  );
}
