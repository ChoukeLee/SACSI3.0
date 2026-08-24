import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "supabase", "migrations", "202608240001_add_cimac_project_and_assets.sql");
const migration = readFileSync(migrationPath, "utf8");
const accessMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202608240002_restrict_cimac_project_access.sql"),
  "utf8",
);
const openingMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202608240004_open_cimac_shops_and_warehouse.sql"),
  "utf8",
);
const reservationMerchantMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202608240005_import_cimac_reservation_merchants.sql"),
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
      "CIMAC-B02": 32,
      "CIMAC-B03": 28,
      "CIMAC-B04": 32,
      "CIMAC-B05": 10,
      "CIMAC-B06": 12,
      "CIMAC-B07": 10,
      "CIMAC-B08": 12,
      "CIMAC-B09": 10,
      "CIMAC-B10": 12,
    });
  });

  it("assigns the confirmed shop-number ranges to buildings 2 and 3", () => {
    const b02 = shops.filter((shop) => shop.building === "CIMAC-B02").map((shop) => shop.unitNo);
    const b03 = shops.filter((shop) => shop.building === "CIMAC-B03").map((shop) => shop.unitNo);
    expect([Math.min(...b02), Math.max(...b02)]).toEqual([201, 232]);
    expect([Math.min(...b03), Math.max(...b03)]).toEqual([301, 328]);
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

  it("opens completed shops and the confirmed warehouse without inventing lease dates", () => {
    expect(openingMigration).toContain("construction_status = 'operational'");
    expect(openingMigration).toContain("occupancy_verified = true");
    expect(openingMigration).toContain("'CIMAC-W01-WAREHOUSE-TBD'");
    expect(openingMigration).toContain("513");
    expect(openingMigration).toContain("付12个月租金赠12个月");
    expect(openingMigration).not.toMatch(/insert into public\.lease_contracts/i);
    expect(openingMigration).not.toMatch(/insert into public\.receivables/i);
  });

  it("keeps committed pre-opening shops reserved until the real opening date", () => {
    const reservedBlock = openingMigration.match(/with committed_shop_numbers[\s\S]*?update public\.units/)?.[0] ?? "";
    const numbers = [...reservedBlock.matchAll(/\('(\d+)'\)/g)].map((match) => match[1]);
    expect(numbers).toHaveLength(49);
    expect(new Set(numbers).size).toBe(49);
    expect(openingMigration).toContain("'reserved'::public.unit_status");
    expect(openingMigration).toContain("'available'::public.unit_status");
  });

  it("imports verified merchant details without fabricating missing records", () => {
    const detailsBlock = reservationMerchantMigration.match(/with reservation_details[\s\S]*?update public\.units/)?.[0] ?? "";
    const unitNumbers = [...detailsBlock.matchAll(/\('(\d+)',/g)].map((match) => match[1]);
    expect(unitNumbers).toHaveLength(47);
    expect(new Set(unitNumbers).size).toBe(47);
    expect(reservationMerchantMigration).toContain("'刘均（罗玉新）'");
    expect(reservationMerchantMigration).toContain("'五金、机电、全屋定制'");
    expect(unitNumbers).not.toContain("303");
    expect(unitNumbers).not.toContain("909");
    expect(reservationMerchantMigration).not.toMatch(/insert into public\.lease_contracts/i);
  });
});
