import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MaintenanceHub } from "@/features/settings";
import { DesktopOnly } from "@/features/mobile";
import type { BuildingRow } from "@/types/database";

export const revalidate = 60;

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const supabase = await createClient();
  const [buildingResult,accountResult]=await Promise.all([
    supabase.from("buildings").select("*").order("code"),
    supabase.rpc("account_access_summary_rpc"),
  ]);
  if(buildingResult.error || accountResult.error) throw new Error("AccountAccessUnavailable");
  const buildings=buildingResult.data;

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="zh" /></div>
      <div className="hidden lg:block">
        <MaintenanceHub
          accounts={accountResult.data ?? []}
          buildings={(buildings as BuildingRow[]) ?? []}
          locale="zh"
        />
      </div>
    </>
  );
}
