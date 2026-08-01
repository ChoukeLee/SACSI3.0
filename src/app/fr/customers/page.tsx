import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CustomerLazyView } from "@/features/customers/customer-lazy-view";
import type { CustomerBuildingSummary } from "@/features/customers";
import type { CustomerRow } from "@/types/database";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

export default async function FrenchCustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");

  return (
    <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
      <FrenchCustomersData canEdit={user.role !== "boss"} />
    </Suspense>
  );
}

async function FrenchCustomersData({ canEdit }: { canEdit: boolean }) {
  const supabase = await createClient();

  const [customersRes, unitsRes, leaseRes, saleRes, dailyRes] = await Promise.all([
    supabase.from("customers").select("*").order("name"),
    supabase.from("units").select("id, unit_no, buildings(id, code, display_name)"),
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

  const unitMap = new Map<string, { unitNo: string; building: CustomerBuildingSummary | null }>();
  const buildingMap = new Map<string, CustomerBuildingSummary>();
  for (const u of (unitsRes.data ?? [])) {
    const rawBuilding = Array.isArray(u.buildings) ? u.buildings[0] : u.buildings;
    const building = rawBuilding
      ? { id: rawBuilding.id, code: rawBuilding.code, label: rawBuilding.display_name || rawBuilding.code }
      : null;
    if (building) buildingMap.set(building.id, building);
    unitMap.set(u.id, { unitNo: u.unit_no, building });
  }

  const customerRooms: Record<string, string[]> = {};
  const customerBuildings: Record<string, CustomerBuildingSummary[]> = {};
  const addRoom = (customerId: string, unitId: string) => {
    const unit = unitMap.get(unitId);
    if (!unit || !customerId) return;
    if (!customerRooms[customerId]) customerRooms[customerId] = [];
    if (!customerRooms[customerId].includes(unit.unitNo)) customerRooms[customerId].push(unit.unitNo);
    if (unit.building) {
      if (!customerBuildings[customerId]) customerBuildings[customerId] = [];
      if (!customerBuildings[customerId].some((building) => building.id === unit.building!.id)) customerBuildings[customerId].push(unit.building);
    }
  };
  for (const r of (leaseRes.data ?? [])) addRoom(r.customer_id, r.unit_id);
  for (const r of (saleRes.data ?? [])) addRoom(r.customer_id, r.unit_id);
  for (const r of (dailyRes.data ?? [])) addRoom(r.customer_id, r.unit_id);

  const customerLastActivity: Record<string, string> = {};
  const setActivity = (customerId: string, date: string) => {
    if (!customerId || !date) return;
    if (!customerLastActivity[customerId] || date > customerLastActivity[customerId]) customerLastActivity[customerId] = date;
  };
  for (const r of (leaseRes.data ?? [])) setActivity(r.customer_id, r.start_date);
  for (const r of (saleRes.data ?? [])) setActivity(r.customer_id, r.signed_date);
  for (const r of (dailyRes.data ?? [])) setActivity(r.customer_id, r.check_in);

  return (
    <CustomerLazyView
      customers={(customersRes.data as CustomerRow[]) ?? []}
      customerSegments={customerSegments}
      customerRooms={customerRooms}
      customerBuildings={customerBuildings}
      buildingOptions={[...buildingMap.values()].sort((a, b) => a.code.localeCompare(b.code))}
      customerLastActivity={customerLastActivity}
      locale="fr"
      canEdit={canEdit}
    />
  );
}
