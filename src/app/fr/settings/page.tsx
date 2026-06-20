import { dictionaries } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "@/features/settings";
import { SystemSettingsPanel } from "@/features/settings/system-settings-panel";
import { DesktopOnly } from "@/features/mobile";
import type { BuildingRow } from "@/types/database";

export const revalidate = 60;

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
  const companyInfo = { name: "Kejian Immobilier", phone: "", address: "" };
  for (const s of (sysSettings ?? [])) {
    const v = typeof s.value === "string" ? s.value : JSON.stringify(s.value);
    try { settingsMap[s.key] = JSON.parse(v); } catch { settingsMap[s.key] = v; }
    if (typeof settingsMap[s.key] === "object") settingsMap[s.key] = JSON.stringify(settingsMap[s.key]);
    if (s.key === "company_name") companyInfo.name = String(settingsMap[s.key]);
    if (s.key === "company_phone") companyInfo.phone = String(settingsMap[s.key]);
    if (s.key === "company_address") companyInfo.address = String(settingsMap[s.key]);
  }

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="fr" /></div>
      <div className="hidden lg:block">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t.title}</h1>
        <div className="space-y-8">
          <SettingsView buildings={(buildings as BuildingRow[]) ?? []} companyInfo={companyInfo} locale="fr" />
          <SystemSettingsPanel settings={settingsMap} isAdmin={user.role === "admin"} locale="fr" />
        </div>
      </div>
    </>
  );
}
