import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const guardMigration = read("supabase/migrations/202608080002_enable_sacsi5_daily_rentals.sql");
const configMigration = read("supabase/migrations/202608080003_configure_sacsi5_daily_units.sql");
const loader = read("src/app/daily-rentals/daily-rental-data.tsx");
const actions = read("src/features/daily-rentals/actions.ts");

describe("multi-building daily rentals", () => {
  it("authorizes units by enabled daily-rental flag instead of a hard-coded building", () => {
    expect(guardMigration).toContain("f.business_type = 'daily_rental'");
    expect(guardMigration).toContain("f.is_enabled = true");
    expect(guardMigration).not.toContain("dailyRentalOnlyAllowedInSacsi11");
    expect(actions).toContain('unit_business_flags!inner(business_type, is_enabled)');
  });

  it("loads both operating buildings and configures the seven confirmed SACSI5 rooms", () => {
    expect(loader).toContain('["SACSI11", "SACSI5"]');
    for (const room of ["1101", "1103", "1302", "1303", "1401", "804", "805"]) {
      expect(configMigration).toContain(`'${room}'`);
    }
    expect(configMigration).toContain("then 80000 else 100000");
  });
});
