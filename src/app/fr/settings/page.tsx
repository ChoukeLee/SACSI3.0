import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "@/features/settings";
import { DesktopOnly } from "@/features/mobile";
import type { BuildingRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin"].includes(user.role)) redirect("/");

  const t = dictionaries.fr.settings;
  const supabase = await createClient();

  const { data: buildings } = await supabase.from("buildings").select("*").order("code");

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="fr" />
      </div>
      <div className="hidden lg:block">
        <PageHeader title={t.title} description={t.description} />
        <SettingsView buildings={(buildings as BuildingRow[]) ?? []} locale="fr" />
      </div>
    </>
  );
}
