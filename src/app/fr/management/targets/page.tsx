import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { TargetsView } from "@/app/management/targets/targets-view";
import type { ReceivableRow, UnitRow, DailyBookingRow, LeaseContractRow, SaleContractRow } from "@/types/database";

export const revalidate = 60;

export default async function FrenchTargetsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss"].includes(user.role)) redirect("/");

  const supabase = await createClient();
  const [
    { data: targets, error: targetsError },
    receivables,
    units,
    bookings,
    leases,
    sales,
  ] = await Promise.all([
    supabase.from("business_targets").select("*").order("period_start", { ascending: false }),
    fetchAllPages<ReceivableRow>(
      (from, to) => supabase.from("receivables").select("*").neq("status", "cancelled")
        .order("due_date").order("id").range(from, to),
      "target receivables",
    ),
    fetchAllPages<UnitRow>(
      (from, to) => supabase.from("units").select("*").order("id").range(from, to),
      "target units",
    ),
    fetchAllPages<DailyBookingRow>(
      (from, to) => supabase.from("daily_bookings").select("*").neq("status", "cancelled")
        .order("check_in").order("id").range(from, to),
      "target daily bookings",
    ),
    fetchAllPages<LeaseContractRow>(
      (from, to) => supabase.from("lease_contracts").select("*").order("id").range(from, to),
      "target lease contracts",
    ),
    fetchAllPages<SaleContractRow>(
      (from, to) => supabase.from("sale_contracts").select("*").order("id").range(from, to),
      "target sale contracts",
    ),
  ]);
  if (targetsError) throw new Error(`Failed to fetch business targets: ${targetsError.message}`);

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Objectifs</h1>
      <TargetsView targets={(targets ?? []) as any[]} receivables={receivables} units={units}
        bookings={bookings} leases={leases} sales={sales}
        locale="fr" userRole={user.role} />
    </>
  );
}
