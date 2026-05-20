import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { TargetsView } from "@/app/management/targets/targets-view";

export const dynamic = "force-dynamic";

export default async function FrenchTargetsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss"].includes(user.role)) redirect("/");

  const supabase = await createClient();
  const { data: targets } = await supabase.from("business_targets").select("*").order("period_start", { ascending: false });
  const { data: receivables } = await supabase.from("receivables").select("*").neq("status", "cancelled").limit(2000);
  const { data: units } = await supabase.from("units").select("*");
  const { data: bookings } = await supabase.from("daily_bookings").select("*").neq("status", "cancelled").limit(500);
  const { data: leases } = await supabase.from("lease_contracts").select("*").limit(200);
  const { data: sales } = await supabase.from("sale_contracts").select("*").limit(200);

  return (
    <>
      <PageHeader title="Objectifs" description="Gerer les objectifs KPI mensuels, trimestriels et annuels" />
      <TargetsView targets={(targets ?? []) as any[]} receivables={receivables ?? []} units={units ?? []}
        bookings={bookings ?? []} leases={leases ?? []} sales={sales ?? []}
        locale="fr" userRole={user.role} />
    </>
  );
}
