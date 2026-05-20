import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "@/features/settings";
import { SystemSettingsPanel } from "@/features/settings/system-settings-panel";
import { DesktopOnly } from "@/features/mobile";
import type { BuildingRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss"].includes(user.role)) redirect("/");

  const t = dictionaries.fr.settings;
  const supabase = await createClient();

  const [{ data: buildings }, { data: sysSettings }] = await Promise.all([
    supabase.from("buildings").select("*").order("code"),
    supabase.from("system_settings").select("key, value"),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const s of (sysSettings ?? [])) {
    const v = typeof s.value === "string" ? s.value : JSON.stringify(s.value);
    try { settingsMap[s.key] = JSON.parse(v); } catch { settingsMap[s.key] = v; }
    if (typeof settingsMap[s.key] === "object") settingsMap[s.key] = JSON.stringify(settingsMap[s.key]);
  }

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="fr" /></div>
      <div className="hidden lg:block">
        <PageHeader title={t.title} description={t.description} />
        <div className="space-y-8">
          <SettingsView buildings={(buildings as BuildingRow[]) ?? []} locale="fr" />
          <SystemSettingsPanel settings={settingsMap} isAdmin={user.role === "admin"} locale="fr" />
        </div>
      </div>
    </>
  );
}
