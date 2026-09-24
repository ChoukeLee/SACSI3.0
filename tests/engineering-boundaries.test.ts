import { readFileSync, readdirSync } from "node:fs";
import { it, expect } from "vitest";
import ts from "typescript";
const read = (file: string) => readFileSync(file, "utf8");
const imports = (file: string) =>
  ts
    .createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
    .statements.filter(ts.isImportDeclaration)
    .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);

it("keeps pure business metadata and calendar calculations free of infrastructure", () => {
  for (const file of [
    "src/features/business-actions/booking-operation-contract.ts",
    "src/features/daily-rentals/calendar-model.ts",
    "src/features/daily-rentals/booking-presentation.ts",
  ])
    expect(
      imports(file).some((name) => /supabase|next\/|actions$|\/calendar$|server-only/.test(name)),
    ).toBe(false);
});
it("prevents presentation modules from importing the large calendar controller", () => {
  for (const file of [
    "src/features/daily-rentals/calendar-view-parts.tsx",
    "src/features/daily-rentals/calendar-finance-panel.tsx",
    "src/features/daily-rentals/booking-panel.tsx",
  ])
    expect(imports(file)).not.toContain("./calendar");
});
it("keeps lease compatibility actions thin and privileged clients out of ordinary receipts", () => {
  const facade = read("src/features/leases/actions.ts");
  expect(facade).not.toMatch(/\.from\(|\.rpc\(|createPrivilegedClient/);
  expect(read("src/features/leases/lease-payment-actions.ts")).not.toContain(
    "createPrivilegedClient",
  );
  for (const file of ["lease-action-guards.ts", "lease-lifecycle-service.ts"])
    expect(read("src/features/leases/" + file)).toContain('import "server-only"');
});
it("runs database regression in CI and classifies new schema migrations", () => {
  expect(read(".github/workflows/ci.yml")).toContain("npm run test:operator-concurrency");
  const manifest = JSON.parse(read("supabase/baselines/rebuild-manifest.json"));
  const classified = new Set(
    [...manifest.overlays, ...manifest.excluded].map((x: { file: string }) => x.file),
  );
  const recent = readdirSync("supabase/migrations").filter(
    (name) => name >= "20260918000000" && name.endsWith(".sql"),
  );
  expect(recent.filter((name) => !classified.has(name))).toEqual([]);
});
it("keeps consolidated finance entry points free of direct multi-table writes", () => {
  for (const file of [
    "src/features/finance/actions.ts",
    "src/features/finance/finance-operation-service.ts",
    "src/features/sales/actions.ts",
    "src/features/daily-rentals/daily-rental-finance.ts",
  ]) {
    expect(read(file)).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
    expect(read(file)).not.toContain("createPrivilegedClient");
  }
});
