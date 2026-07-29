import { redirect } from "next/navigation";
import { configuredAccountSummaries, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MaintenanceHub } from "@/features/settings";
import { DesktopOnly } from "@/features/mobile";
import type { BuildingRow } from "@/types/database";

export const revalidate = 60;

export default async function FrenchSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const supabase = await createClient();
  const { data: buildings } = await supabase.from("buildings").select("*").order("code");

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="fr" /></div>
      <div className="hidden lg:block">
        <MaintenanceHub
          accounts={configuredAccountSummaries}
          buildings={(buildings as BuildingRow[]) ?? []}
          locale="fr"
        />
      </div>
    </>
  );
}
