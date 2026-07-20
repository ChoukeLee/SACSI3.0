import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { UnitLazyView } from "@/features/units/unit-lazy-view";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import type { UnitRow, UnitBusinessFlagRow } from "@/types/database";

export default async function FrenchUnitsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss"].includes(user.role)) redirect("/");

  return (
    <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
      <FrenchUnitsData />
    </Suspense>
  );
}

async function FrenchUnitsData() {
  const supabase = await createClient();
  const { data: allBuildings, error: bldErr } = await supabase
    .from("buildings")
    .select("id, code, display_name")
    .eq("is_active", true)
    .order("code");

  if (bldErr) {
    console.error("Failed to fetch buildings:", bldErr);
    return <div>Failed to load buildings</div>;
  }

  const buildingIds = allBuildings?.map((b) => b.id) ?? [];
  let units: UnitRow[] = [];
  let flags: UnitBusinessFlagRow[] = [];
  let managedLeaseUnitIds: string[] = [];

  const [flagsRes] = await Promise.all([
    supabase.from("unit_business_flags").select("unit_id, business_type, is_enabled, default_price_xof"),
  ]);

  if (!flagsRes.error) flags = flagsRes.data;

  if (buildingIds.length > 0) {
    const { data: unitsData, error: unitsErr } = await supabase
      .from("units")
      .select("id, building_id, code, unit_no, floor_label, kind, status, area_sqm, layout, furnishing, notes")
      .in("building_id", buildingIds)
      .order("unit_no");
    if (!unitsErr) units = sortUnits(unitsData as unknown as UnitRow[]);

    if (units.length > 0) {
      const unitIds = units.map((unit) => unit.id);
      const { data: activeLeases } = await supabase
        .from("lease_contracts")
        .select("unit_id")
        .eq("status", "active")
        .in("unit_id", unitIds);
      managedLeaseUnitIds = Array.from(new Set((activeLeases ?? []).map((lease) => lease.unit_id)));
    }
  }

  const businessFlagsMap: Record<string, UnitBusinessFlagRow[]> = {};
  const unitCodeById = new Map(units.map((unit) => [unit.id, unit.code]));
  for (const flag of flags) {
    if (unitCodeById.get(flag.unit_id) === "SACSI11-503" && flag.business_type === "daily_rental") continue;
    if (!businessFlagsMap[flag.unit_id]) businessFlagsMap[flag.unit_id] = [];
    businessFlagsMap[flag.unit_id].push(flag);
  }

  const auditLogsMap: Record<string, { id: string; action: string; metadata: Record<string, unknown>; created_at: string }[]> = {};
  if (buildingIds.length > 0 && units.length > 0) {
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

  return <UnitLazyView units={units} businessFlagsMap={businessFlagsMap} managedLeaseUnitIds={managedLeaseUnitIds} auditLogsMap={auditLogsMap} buildings={allBuildings ?? []} locale="fr" />;
}
