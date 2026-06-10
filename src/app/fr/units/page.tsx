
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { UnitList } from "@/features/units";
import type { UnitRow, UnitBusinessFlagRow } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FrenchUnitsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin","front_desk","finance","boss"].includes(user.role)) redirect("/");

  const supabase = await createClient();

  let units: UnitRow[] = [];
  let flags: UnitBusinessFlagRow[] = [];
  let managedLeaseUnitIds: string[] = [];

  const [buildingRes, flagsRes] = await Promise.all([
    supabase.from("buildings").select("id").eq("code", "SASCI11").single(),
    supabase.from("unit_business_flags").select("unit_id, business_type, is_enabled, default_price_xof"),
  ]);

  if (!flagsRes.error) flags = flagsRes.data;

  const buildingId = buildingRes.data?.id;
  if (buildingId) {
    const { data: unitsData, error: unitsErr } = await supabase.from("units").select("id, building_id, code, unit_no, floor_label, kind, status, area_sqm, layout, furnishing, notes").eq("building_id", buildingId).order("unit_no");
    if (!unitsErr) units = sortUnits(unitsData as unknown as UnitRow[]);
  }

  if (buildingId && units.length > 0) {
    const unitIds = units.map((unit) => unit.id);
    const { data: activeLeases } = await supabase
      .from("lease_contracts")
      .select("unit_id")
      .eq("status", "active")
      .in("unit_id", unitIds);
    managedLeaseUnitIds = Array.from(new Set((activeLeases ?? []).map((lease) => lease.unit_id)));
  }

  const businessFlagsMap: Record<string, UnitBusinessFlagRow[]> = {};
  for (const flag of flags) {
    if (!businessFlagsMap[flag.unit_id]) businessFlagsMap[flag.unit_id] = [];
    businessFlagsMap[flag.unit_id].push(flag);
  }

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

  return <UnitList units={units} businessFlagsMap={businessFlagsMap} managedLeaseUnitIds={managedLeaseUnitIds} auditLogsMap={auditLogsMap} locale="fr" />;
}
