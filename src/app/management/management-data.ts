import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { ProjectRow } from "@/types/database";

export interface CimacBuildingOverview {
  id: string;
  code: string;
  displayName: string;
  firstShopNo: string | null;
  lastShopNo: string | null;
  shopCount: number;
  primeCount: number;
  standardCount: number;
  unverifiedCount: number;
  operationalCount: number;
  leasedCount: number;
  standardMonthlyRentXof: number;
  shops: CimacShopOverview[];
}

export interface CimacShopOverview {
  id: string;
  unitNo: string;
  status: string;
  areaSqm: number | null;
  standardMonthlyRentXof: number;
  isPrime: boolean;
  tenantName: string | null;
  mainBusiness: string | null;
  hasActiveLease: boolean;
}

export interface CimacOverview {
  project: Pick<
    ProjectRow,
    "id" | "code" | "display_name" | "brand_name" | "construction_status" | "allows_sale"
  >;
  buildingCount: number;
  shopCount: number;
  primeCount: number;
  standardCount: number;
  unverifiedCount: number;
  operationalCount: number;
  leasedCount: number;
  standardMonthlyRentXof: number;
  buildings: CimacBuildingOverview[];
  assetInventory: {
    subtype: string;
    count: number;
    areaSqm: number | null;
    operational: number;
    unverified: number;
  }[];
}

export const getProjects = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, code, display_name, brand_name, project_kind, construction_status, allows_daily_rental, allows_long_lease, allows_sale, is_active, notes, created_at, updated_at",
    )
    .eq("is_active", true)
    .order("code");
  if (error) throw new Error(`Failed to load projects: ${error.message}`);
  return (data ?? []) as ProjectRow[];
});

export const getBuildings = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buildings")
    .select("id, project_id, display_name, is_active, code, construction_status")
    .eq("is_active", true)
    .order("code");
  if (error) throw new Error(`Failed to load buildings: ${error.message}`);
  return data ?? [];
});

export const getCimacOverview = cache(async (): Promise<CimacOverview | null> => {
  const supabase = await createClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, code, display_name, brand_name, construction_status, allows_sale")
    .eq("code", "CIMAC")
    .maybeSingle();
  if (projectError) throw new Error(`Failed to load CIMAC project: ${projectError.message}`);
  if (!project) return null;

  const { data: buildings, error: buildingError } = await supabase
    .from("buildings")
    .select("id, code, display_name")
    .eq("project_id", project.id)
    .eq("is_active", true)
    .order("code");
  if (buildingError) throw new Error(`Failed to load CIMAC buildings: ${buildingError.message}`);
  const buildingRows = buildings ?? [];
  const buildingIds = buildingRows.map((building) => building.id);

  const units =
    buildingIds.length === 0
      ? []
      : await fetchAllPages(
          (from, to) =>
            supabase
              .from("units")
              .select(
                "id, unit_no, building_id, status, kind, asset_subtype, area_sqm, construction_status, location_grade, occupancy_verified, reservation_holder_name, reservation_main_business, unit_business_flags(business_type,is_enabled,default_price_xof)",
              )
              .in("building_id", buildingIds)
              .order("unit_no")
              .order("id")
              .range(from, to),
          "CIMAC asset inventory",
        );

  const allUnits = units as Array<{
    id: string;
    unit_no: string;
    building_id: string;
    status: string;
    asset_subtype: string;
    kind: string;
    area_sqm: number | null;
    construction_status: string;
    location_grade: string | null;
    occupancy_verified: boolean;
    reservation_holder_name: string | null;
    reservation_main_business: string | null;
    unit_business_flags: Array<{
      business_type: string;
      is_enabled: boolean;
      default_price_xof: number | null;
    }>;
  }>;
  const unitRows = allUnits.filter((unit) => unit.asset_subtype === "commercial_shop");
  const commercialBuildingRows = buildingRows.filter((building) =>
    unitRows.some((unit) => unit.building_id === building.id),
  );
  const inventoryGroups = [
    "commercial_shop",
    "warehouse",
    "apartment",
    "apartment_ground_floor_shop",
  ];
  const assetInventory = inventoryGroups.map((subtype) => {
    const records = allUnits.filter(
      (unit) =>
        unit.asset_subtype === subtype ||
        (subtype === "apartment" &&
          unit.kind === "apartment" &&
          unit.asset_subtype !== "apartment_ground_floor_shop"),
    );
    return {
      subtype,
      count: records.length,
      areaSqm:
        records.length > 0 && records.every((unit) => unit.area_sqm !== null)
          ? records.reduce((sum, unit) => sum + Number(unit.area_sqm), 0)
          : null,
      operational: records.filter((unit) => unit.construction_status === "operational").length,
      unverified: records.filter(
        (unit) => !unit.occupancy_verified || unit.construction_status === "unverified",
      ).length,
    };
  });
  const rentFor = (unit: (typeof unitRows)[number]) =>
    Number(
      unit.unit_business_flags?.find(
        (flag) => flag.business_type === "long_lease" && flag.is_enabled,
      )?.default_price_xof ?? 0,
    );
  const { data: leases, error: leaseError } =
    buildingIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("lease_contracts")
          .select("unit_id, customers(name), units!inner(building_id)")
          .in("units.building_id", buildingIds)
          .eq("status", "active");
  if (leaseError) throw new Error(`Failed to load CIMAC tenants: ${leaseError.message}`);
  const tenantByUnitId = new Map(
    (leases ?? []).map((lease) => {
      const customer = lease.customers as { name: string } | Array<{ name: string }> | null;
      return [
        lease.unit_id,
        Array.isArray(customer) ? (customer[0]?.name ?? null) : (customer?.name ?? null),
      ];
    }),
  );
  const buildingSummaries = commercialBuildingRows.map((building) => {
    const shops = unitRows.filter((unit) => unit.building_id === building.id);
    const shopNumbers = shops
      .map((unit) => unit.unit_no)
      .sort((left, right) => Number(left) - Number(right) || left.localeCompare(right));
    return {
      id: building.id,
      code: building.code,
      displayName: building.display_name,
      firstShopNo: shopNumbers[0] ?? null,
      lastShopNo: shopNumbers.at(-1) ?? null,
      shopCount: shops.length,
      primeCount: shops.filter((unit) => unit.location_grade === "central_avenue_prime").length,
      standardCount: shops.filter((unit) => unit.location_grade === "standard").length,
      unverifiedCount: shops.filter(
        (unit) => !unit.occupancy_verified || unit.construction_status === "unverified",
      ).length,
      operationalCount: shops.filter((unit) => unit.construction_status === "operational").length,
      leasedCount: shops.filter((unit) => unit.status === "leased" && unit.occupancy_verified)
        .length,
      standardMonthlyRentXof: shops.reduce((sum, unit) => sum + rentFor(unit), 0),
      shops: shops.map((unit) => ({
        id: unit.id,
        unitNo: unit.unit_no,
        status: unit.status,
        areaSqm: unit.area_sqm,
        standardMonthlyRentXof: rentFor(unit),
        isPrime: unit.location_grade === "central_avenue_prime",
        tenantName: tenantByUnitId.get(unit.id) ?? unit.reservation_holder_name ?? null,
        mainBusiness: unit.reservation_main_business ?? null,
        hasActiveLease: tenantByUnitId.has(unit.id),
      })),
    };
  });

  return {
    project: project as CimacOverview["project"],
    buildingCount: buildingSummaries.length,
    shopCount: unitRows.length,
    primeCount: unitRows.filter((unit) => unit.location_grade === "central_avenue_prime").length,
    standardCount: unitRows.filter((unit) => unit.location_grade === "standard").length,
    unverifiedCount: unitRows.filter(
      (unit) => !unit.occupancy_verified || unit.construction_status === "unverified",
    ).length,
    operationalCount: unitRows.filter((unit) => unit.construction_status === "operational").length,
    leasedCount: unitRows.filter((unit) => unit.status === "leased" && unit.occupancy_verified)
      .length,
    standardMonthlyRentXof: unitRows.reduce((sum, unit) => sum + rentFor(unit), 0),
    buildings: buildingSummaries,
    assetInventory,
  };
});
