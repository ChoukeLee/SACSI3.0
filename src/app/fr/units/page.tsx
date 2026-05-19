
import { PageHeader } from "@/components/page-header";
import { dictionaries } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UnitList } from "@/features/units";
import type { UnitRow, UnitBusinessFlagRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchUnitsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin","front_desk","finance","boss"].includes(user.role)) redirect("/");

  const t = dictionaries.fr.units;
  const supabase = await createClient();

  const { data: building } = await supabase
    .from("buildings")
    .select("id")
    .eq("code", "SASCI11")
    .single();

  const buildingId = building?.id;

  let units: UnitRow[] = [];
  let flags: UnitBusinessFlagRow[] = [];

  if (buildingId) {
    const [unitsRes, flagsRes] = await Promise.all([
      supabase.from("units").select("*").eq("building_id", buildingId).order("unit_no"),
      supabase.from("unit_business_flags").select("*"),
    ]);

    if (!unitsRes.error) units = unitsRes.data.sort((a, b) => {
      const aNum = parseInt(a.unit_no, 10);
      const bNum = parseInt(b.unit_no, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      if (!isNaN(aNum)) return -1;
      if (!isNaN(bNum)) return 1;
      return a.unit_no.localeCompare(b.unit_no);
    });
    if (!flagsRes.error) flags = flagsRes.data;
  }

  const businessFlagsMap: Record<string, UnitBusinessFlagRow[]> = {};
  for (const flag of flags) {
    if (!businessFlagsMap[flag.unit_id]) businessFlagsMap[flag.unit_id] = [];
    businessFlagsMap[flag.unit_id].push(flag);
  }

  // Pre-fetch audit logs
  const auditLogsMap: Record<string, { id: string; action: string; metadata: Record<string, unknown>; created_at: string }[]> = {};
  if (buildingId && units.length > 0) {
    const unitIds = units.map((u) => u.id);
    const { data: logs } = await supabase
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, metadata, created_at")
      .eq("entity_type", "unit")
      .eq("action", "status_change")
      .in("entity_id", unitIds)
      .order("created_at", { ascending: false })
      .limit(200);

    if (logs) {
      for (const log of logs) {
        if (!log.entity_id) continue;
        if (!auditLogsMap[log.entity_id]) auditLogsMap[log.entity_id] = [];
        auditLogsMap[log.entity_id].push({
          id: log.id,
          action: log.action,
          metadata: log.metadata as Record<string, unknown>,
          created_at: log.created_at,
        });
      }
    }
  }

  return (
      <>

<><PageHeader title={t.title} description={t.description} />
      <UnitList
        units={units}
        businessFlagsMap={businessFlagsMap}
        auditLogsMap={auditLogsMap}
        locale="fr"
      />

      </>
</>);
}
