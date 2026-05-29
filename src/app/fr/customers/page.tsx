import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CustomerList } from "@/features/customers";
import type { CustomerRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchCustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss"].includes(user.role)) redirect("/");

  const supabase = await createClient();

  const [customersRes, unitsRes, leaseRes, saleRes, dailyRes] = await Promise.all([
    supabase.from("customers").select("*").order("name"),
    supabase.from("units").select("id, unit_no"),
    supabase.from("lease_contracts").select("customer_id, unit_id, start_date").limit(2000),
    supabase.from("sale_contracts").select("customer_id, unit_id, signed_date").limit(2000),
    supabase.from("daily_bookings").select("customer_id, unit_id, check_in").limit(2000),
  ]);

  if (customersRes.error) console.error("Failed to fetch customers:", customersRes.error);

  const customerSegments = {
    leaseCustomerIds: [...new Set((leaseRes.data ?? []).map((row) => row.customer_id).filter(Boolean))],
    saleCustomerIds: [...new Set((saleRes.data ?? []).map((row) => row.customer_id).filter(Boolean))],
    dailyCustomerIds: [...new Set((dailyRes.data ?? []).map((row) => row.customer_id).filter(Boolean))],
  };

  // Build unit_no lookup
  const unitMap = new Map<string, string>();
  for (const u of (unitsRes.data ?? [])) unitMap.set(u.id, u.unit_no);

  // Customer → room numbers
  const customerRooms: Record<string, string[]> = {};
  const addRoom = (customerId: string, unitId: string) => {
    const unitNo = unitMap.get(unitId);
    if (!unitNo || !customerId) return;
    if (!customerRooms[customerId]) customerRooms[customerId] = [];
    if (!customerRooms[customerId].includes(unitNo)) customerRooms[customerId].push(unitNo);
  };
  for (const r of (leaseRes.data ?? [])) addRoom(r.customer_id, r.unit_id);
  for (const r of (saleRes.data ?? [])) addRoom(r.customer_id, r.unit_id);
  for (const r of (dailyRes.data ?? [])) addRoom(r.customer_id, r.unit_id);

  // Customer last activity date
  const customerLastActivity: Record<string, string> = {};
  const setActivity = (customerId: string, date: string) => {
    if (!customerId || !date) return;
    if (!customerLastActivity[customerId] || date > customerLastActivity[customerId]) {
      customerLastActivity[customerId] = date;
    }
  };
  for (const r of (leaseRes.data ?? [])) setActivity(r.customer_id, r.start_date);
  for (const r of (saleRes.data ?? [])) setActivity(r.customer_id, r.signed_date);
  for (const r of (dailyRes.data ?? [])) setActivity(r.customer_id, r.check_in);

  return (
    <CustomerList
      customers={(customersRes.data as CustomerRow[]) ?? []}
      customerSegments={customerSegments}
      customerRooms={customerRooms}
      customerLastActivity={customerLastActivity}
      locale="fr"
    />
  );
}
