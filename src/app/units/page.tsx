import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { UnitList } from "@/features/units";
import type { UnitRow, UnitBusinessFlagRow } from "@/types/database";
import type { BusinessType } from "@/types/domain";

export const dynamic = "force-dynamic";

export default async function UnitsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss"].includes(user.role)) redirect("/");

  const t = dictionaries.zh.units;
  const supabase = await createClient();

  // Fetch building_id for SASCI11 (primary building for phase 1)
  const { data: building } = await supabase
    .from("buildings")
    .select("id")
    .eq("code", "SASCI11")
    .single();

  const buildingId = building?.id;

  // Fetch all units for this building
  let units: UnitRow[] = [];
  let flags: UnitBusinessFlagRow[] = [];

  if (buildingId) {
    const [unitsRes, flagsRes] = await Promise.all([
      supabase.from("units").select("*").eq("building_id", buildingId).order("unit_no"),
      supabase.from("unit_business_flags").select("*"),
    ]);

    if (unitsRes.error) console.error("Failed to fetch units:", unitsRes.error);
    else units = sortUnits(unitsRes.data);

    if (flagsRes.error) console.error("Failed to fetch business flags:", flagsRes.error);
    else flags = flagsRes.data;
  }

  // Build business flags map
  const businessFlagsMap: Record<string, UnitBusinessFlagRow[]> = {};
  for (const flag of flags) {
    if (!businessFlagsMap[flag.unit_id]) businessFlagsMap[flag.unit_id] = [];
    businessFlagsMap[flag.unit_id].push(flag);
  }

  // Audit logs map — populated on demand via client-side or pre-fetched for units with history.
  // For now we pass empty; the detail panel can refetch when opened.
  const auditLogsMap: Record<string, { id: string; action: string; metadata: Record<string, unknown>; created_at: string }[]> = {};

  // Pre-fetch audit logs for units that have status_change entries
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
      <UnitList
        units={units}
        businessFlagsMap={businessFlagsMap}
        auditLogsMap={auditLogsMap}
        locale="zh"
      />
    </>
  );
}
