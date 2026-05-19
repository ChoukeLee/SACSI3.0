import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "@/features/settings";
import { DesktopOnly } from "@/features/mobile";
import type { BuildingRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin"].includes(user.role)) redirect("/");

  const t = dictionaries.zh.settings;
  const supabase = await createClient();

  const { data: buildings } = await supabase.from("buildings").select("*").order("code");

  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale="zh" />
      </div>
      <div className="hidden lg:block">
        <PageHeader title={t.title} description={t.description} />
        <SettingsView buildings={(buildings as BuildingRow[]) ?? []} locale="zh" />
      </div>
    </>
  );
}
