import "server-only";

import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import { getUnitPartySummaries } from "@/features/units/unit-party-summary";
import type { UnitBusinessFlagRow, UnitRow } from "@/types/database";

type AuditLogEntry = {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function loadUnitPageData() {
  const supabase = await createClient();

  const [buildingsRes, flagsRes, unitsRes] = await Promise.all([
    supabase.from("buildings").select("id, code, display_name").eq("is_active", true).order("code"),
    supabase.from("unit_business_flags").select("unit_id, business_type, is_enabled, default_price_xof"),
    supabase.from("units")
      .select("id, building_id, code, unit_no, floor_label, kind, status, area_sqm, layout, furnishing, notes")
      .order("unit_no"),
  ]);

  if (buildingsRes.error) throw new Error(`Failed to load unit buildings: ${buildingsRes.error.message}`);
  if (flagsRes.error) throw new Error(`Failed to load unit business flags: ${flagsRes.error.message}`);
  if (unitsRes.error) throw new Error(`Failed to load units: ${unitsRes.error.message}`);

  const buildings = buildingsRes.data ?? [];
  const activeBuildingIds = new Set(buildings.map((building) => building.id));
  const units = sortUnits((unitsRes.data ?? []).filter((unit) => activeBuildingIds.has(unit.building_id)) as unknown as UnitRow[]);
  const unitIds = units.map((unit) => unit.id);

  const [partyData, logsRes] = unitIds.length > 0
    ? await Promise.all([
        getUnitPartySummaries(supabase, unitIds),
        supabase.from("audit_logs")
          .select("id, action, entity_type, entity_id, metadata, created_at")
          .eq("entity_type", "unit")
          .eq("action", "status_change")
          .in("entity_id", unitIds)
          .order("created_at", { ascending: false })
          .limit(200),
      ])
    : [{ summaries: {}, activeLeaseUnitIds: [] }, { data: [], error: null }];

  if (logsRes.error) throw new Error(`Failed to load unit audit logs: ${logsRes.error.message}`);

  const businessFlagsMap: Record<string, UnitBusinessFlagRow[]> = {};
  const sacsi11Id = buildings.find((building) => building.code === "SACSI11")?.id;
  const sacsi11503Id = units.find((unit) => unit.building_id === sacsi11Id && unit.unit_no === "503")?.id;
  for (const flag of flagsRes.data ?? []) {
    if (flag.unit_id === sacsi11503Id && flag.business_type === "daily_rental") continue;
    if (!businessFlagsMap[flag.unit_id]) businessFlagsMap[flag.unit_id] = [];
    businessFlagsMap[flag.unit_id].push(flag as UnitBusinessFlagRow);
  }

  const sacsi7Storefront = units.find((unit) => unit.code === "SACSI7-STOREFRONT");
  if (sacsi7Storefront && !businessFlagsMap[sacsi7Storefront.id]?.some((flag) => flag.business_type === "long_lease")) {
    businessFlagsMap[sacsi7Storefront.id] = [
      ...(businessFlagsMap[sacsi7Storefront.id] ?? []),
      { unit_id: sacsi7Storefront.id, business_type: "long_lease", is_enabled: true, default_price_xof: 1_200_000 },
    ];
  }

  const auditLogsMap: Record<string, AuditLogEntry[]> = {};
  for (const log of logsRes.data ?? []) {
    if (!log.entity_id) continue;
    if (!auditLogsMap[log.entity_id]) auditLogsMap[log.entity_id] = [];
    auditLogsMap[log.entity_id].push({
      id: log.id,
      action: log.action,
      metadata: log.metadata as Record<string, unknown>,
      created_at: log.created_at,
    });
  }

  return {
    units,
    businessFlagsMap,
    managedLeaseUnitIds: partyData.activeLeaseUnitIds,
    unitPartySummaries: partyData.summaries,
    auditLogsMap,
    buildings,
  };
}
