import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  cimacLegacyHref,
  type LegacyBusinessArea,
  type LegacyBusinessParams,
} from "./cimac-legacy-routing";

/** Current-user RLS lookup; no write, no privileged client, no project inferred from a name. */
export async function redirectLegacyCimac(
  area: LegacyBusinessArea,
  params: LegacyBusinessParams,
  locale: "zh" | "fr",
) {
  const one = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) throw new Error("BusinessWorkspaceScopeUnavailable");
    return value;
  };
  const project = one("project") ?? one("projectId");
  const buildingId = one("building") ?? one("buildingId");
  const unitId = one("unit");
  const contractId = one("contract");
  const returnTo = one("returnTo");
  const customerWorkspace = area === "finance" && one("view") === "customers";
  if (one("project") && one("projectId") && one("project") !== one("projectId"))
    throw new Error("BusinessWorkspaceScopeUnavailable");
  if (
    !project &&
    !buildingId &&
    !unitId &&
    !contractId &&
    !customerWorkspace &&
    !returnTo?.match(/^\/(?:fr\/)?cimac(?:\/|\?|$)/)
  )
    return;
  const client = await createClient();
  const { data: cimac, error } = await client
    .from("projects")
    .select("id,code")
    .eq("code", "CIMAC")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error("BusinessWorkspaceScopeUnavailable");
  if (!cimac) return;
  let matched =
    project?.toUpperCase() === "CIMAC" || project === cimac.id || (!project && customerWorkspace);
  let resolvedBuilding = buildingId;
  if (buildingId) {
    const { data, error: readError } = await client
      .from("buildings")
      .select("id,project_id")
      .eq(
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(buildingId) ? "id" : "code",
        buildingId,
      )
      .maybeSingle();
    if (readError) throw new Error("BusinessWorkspaceScopeUnavailable");
    if (!data) throw new Error("BusinessWorkspaceScopeUnavailable");
    resolvedBuilding = data.id;
  }
  if (contractId && (area === "leases" || area === "sales")) {
    const { data, error: readError } = await client
      .from(area === "leases" ? "lease_contracts" : "sale_contracts")
      .select("unit_id")
      .eq("id", contractId)
      .maybeSingle();
    if (readError) throw new Error("BusinessWorkspaceScopeUnavailable");
    if (data?.unit_id) {
      const { data: unit, error: unitError } = await client
        .from("units")
        .select("building_id")
        .eq("id", data.unit_id)
        .maybeSingle();
      if (unitError) throw new Error("BusinessWorkspaceScopeUnavailable");
      if (resolvedBuilding && unit && resolvedBuilding !== unit.building_id)
        throw new Error("BusinessWorkspaceScopeUnavailable");
      resolvedBuilding = unit?.building_id ?? resolvedBuilding;
    }
  } else if (unitId) {
    const { data, error: readError } = await client
      .from("units")
      .select("building_id")
      .eq("id", unitId)
      .maybeSingle();
    if (readError) throw new Error("BusinessWorkspaceScopeUnavailable");
    if (resolvedBuilding && data && resolvedBuilding !== data.building_id)
      throw new Error("BusinessWorkspaceScopeUnavailable");
    resolvedBuilding = data?.building_id ?? resolvedBuilding;
  }
  if (resolvedBuilding) {
    const { data, error: readError } = await client
      .from("buildings")
      .select("id,project_id")
      .eq("id", resolvedBuilding)
      .maybeSingle();
    if (readError) throw new Error("BusinessWorkspaceScopeUnavailable");
    if (
      data &&
      ((matched && data.project_id !== cimac.id) ||
        (project && !matched && data.project_id === cimac.id))
    )
      throw new Error("BusinessWorkspaceScopeUnavailable");
    matched ||= data?.project_id === cimac.id;
  }
  if (!project && !resolvedBuilding && returnTo?.match(/^\/(?:fr\/)?cimac(?:\/|\?|$)/))
    matched = true;
  if (!matched) return;
  const canonical = { ...params };
  if (resolvedBuilding && ["leases", "customers", "units"].includes(area))
    canonical.building = resolvedBuilding;
  redirect(cimacLegacyHref(area, canonical, locale));
}
