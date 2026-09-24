import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
// @ts-expect-error Data-free compiler shared with native tests.
import { applicationRebuildPlan } from "../scripts/lib/application-rebuild.mjs";
it("pins every rebuild source and excludes real personnel configuration", () => {
  const { steps, manifest } = applicationRebuildPlan();
  expect(steps).toHaveLength(18);
  expect(
    manifest.excluded.some((entry: { file: string }) => entry.file.includes("finance_controller")),
  ).toBe(true);
  // Stored authorization definitions may mention a role account. The excluded
  // personnel migration must not be executed; zero actual users is checked in PostgreSQL.
  expect(steps.some((step: { name: string }) => step.name.includes("finance_controller"))).toBe(
    false,
  );
});
it("refuses changed migration contents before executing any SQL", () => {
  const read = (path: string) =>
    readFileSync("supabase/" + path, "utf8") +
    (path.includes("operator_booking_operations.sql") ? "\n-- unreviewed change" : "");
  expect(() => applicationRebuildPlan(read)).toThrow("Rebuild source changed");
});
