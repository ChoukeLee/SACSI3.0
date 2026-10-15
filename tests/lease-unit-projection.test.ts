import { expect, it } from "vitest";
import { projectLeaseWorkspaceUnit } from "../src/features/leases/lease-unit-projection";
import { workspaceFixture } from "./fixtures/contract-workspace";
it("preserves the existing storefront virtual enablement/price append rule without altering real facts", () => {
  const unit = {
    ...workspaceFixture().units[0],
    code: "SACSI7-STOREFRONT",
    unit_business_flags: [
      { business_type: "long_lease" as const, is_enabled: false, default_price_xof: 20 },
    ],
  };
  const projected = projectLeaseWorkspaceUnit(unit);
  expect(projected.unit_business_flags).toEqual([
    ...unit.unit_business_flags,
    { business_type: "long_lease", is_enabled: true, default_price_xof: 1200000 },
  ]);
  expect(unit.unit_business_flags).toHaveLength(1);
  const regular = workspaceFixture().units[0];
  expect(projectLeaseWorkspaceUnit(regular)).toBe(regular);
});
