import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "supabase", "migrations", "202608240001_add_cimac_project_and_assets.sql");
const migration = readFileSync(migrationPath, "utf8");
const accessMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202608240002_restrict_cimac_project_access.sql"),
  "utf8",
);

type Shop = { building: string; unitNo: number; areaSqm: number; monthlyRentXof: number; prime: boolean };

function parseConfirmedShops(): Shop[] {
  const rangePattern = /\('CIMAC-B(\d{2})',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(true|false),\s*'[^']+'\)/g;
  const shops: Shop[] = [];
  for (const match of migration.matchAll(rangePattern)) {
    const [, buildingNo, firstNo, lastNo, areaSqm, priceWan, prime] = match;
    for (let unitNo = Number(firstNo); unitNo <= Number(lastNo); unitNo += 1) {
      shops.push({
        building: `CIMAC-B${buildingNo}`,
        unitNo,
        areaSqm: Number(areaSqm),
        monthlyRentXof: Number(priceWan) * 10_000,
        prime: prime === "true",
      });
    }
  }
  return shops;
}

describe("CIMAC confirmed commercial inventory", () => {
  const shops = parseConfirmedShops();

  it("registers exactly 186 unique shops across ten buildings", () => {
    expect(shops).toHaveLength(186);
    expect(new Set(shops.map((shop) => `${shop.building}-${shop.unitNo}`)).size).toBe(186);
    expect(new Set(shops.map((shop) => shop.building)).size).toBe(10);
    expect(Object.fromEntries([...new Set(shops.map((shop) => shop.building))].map((building) => [building, shops.filter((shop) => shop.building === building).length]))).toEqual({
      "CIMAC-B01": 28,
      "CIMAC-B02": 28,
      "CIMAC-B03": 32,
      "CIMAC-B04": 32,
      "CIMAC-B05": 10,
      "CIMAC-B06": 12,
      "CIMAC-B07": 10,
      "CIMAC-B08": 12,
      "CIMAC-B09": 10,
      "CIMAC-B10": 12,
    });
  });

  it("keeps the confirmed location and monthly-rent totals", () => {
    expect(shops.filter((shop) => shop.prime)).toHaveLength(50);
    expect(shops.filter((shop) => !shop.prime)).toHaveLength(136);
    expect(shops.reduce((sum, shop) => sum + shop.monthlyRentXof, 0)).toBe(284_950_000);
  });

  it("seeds no occupancy, handwritten party or finance state", () => {
    expect(migration).toContain("'locked'::public.unit_status");
    expect(migration).toContain("'unverified'");
    expect(migration).toMatch(/false\r?\n\s+from expanded/);
    expect(migration).not.toMatch(/tenant_name|customer_name|receipt_no|contract_no/);
  });

  it("enforces the rental-only project policy at the database boundary", () => {
    expect(migration).toMatch(/'CIMAC'[\s\S]*false, true, false/);
    expect(migration).toContain("projectSaleDisabled");
    expect(migration).toContain("projectDailyRentalDisabled");
    expect(migration).toContain("trg_sale_project_business_mode");
  });

  it("restricts CIMAC to the Chouke and boss accounts", () => {
    expect(accessMigration).toContain("'admin@sacsi.com'::text");
    expect(accessMigration).toContain("'boss@sacsi.com'::text");
    expect(accessMigration).toContain("as restrictive for all to authenticated");
    expect(accessMigration).toContain('"project account restricts buildings"');
    expect(accessMigration).toContain('"project account restricts units"');
    expect(accessMigration).toContain('"project account restricts leases"');
  });
});
