import type { WorkspaceUnit } from "@/features/contracts/workspace-model";
/** Compatibility projection only: preserve the legacy storefront rule and append priority. */
export function projectLeaseWorkspaceUnit(unit: WorkspaceUnit): WorkspaceUnit {
  if (unit.code !== "SACSI7-STOREFRONT") return unit;
  return {
    ...unit,
    unit_business_flags: [
      ...(unit.unit_business_flags ?? []),
      { business_type: "long_lease", is_enabled: true, default_price_xof: 1_200_000 },
    ],
  };
}
