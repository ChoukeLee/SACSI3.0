import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "@/features/settings";
import type { BuildingRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchSettingsPage() {
  const t = dictionaries.fr.settings;
  const supabase = await createClient();

  const { data: buildings } = await supabase.from("buildings").select("*").order("code");

  return (
    <AppShell locale="fr">
      <PageHeader title={t.title} description={t.description} />
      <SettingsView buildings={(buildings as BuildingRow[]) ?? []} locale="fr" />
    </AppShell>
  );
}
