import "server-only";

import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import type { UnitPartySummary } from "@/features/units/unit-party-summary";
import type { BuildingRow, UnitBusinessFlagRow, UnitRow } from "@/types/database";

type RelatedCustomer = { name: string } | Array<{ name: string }> | null;

type CatalogUnit = UnitRow & {
  building: Pick<BuildingRow, "id" | "code" | "display_name"> | Array<Pick<BuildingRow, "id" | "code" | "display_name">>;
  unit_business_flags: UnitBusinessFlagRow[];
  lease_contracts: Array<{
    customer_id: string;
    expected_end_date: string | null;
    expected_end_confirmed: boolean | null;
    start_date: string;
    customer: RelatedCustomer;
  }>;
  sale_contracts: Array<{
    customer_id: string;
    signed_date: string;
    customer: RelatedCustomer;
  }>;
  daily_bookings: Array<{
    customer_id: string;
    check_in: string;
    check_out: string | null;
    checkout_mode: string | null;
    actual_check_out: string | null;
    status: string;
    customer: RelatedCustomer;
  }>;
};

const customerName = (customer: RelatedCustomer) => {
  const row = Array.isArray(customer) ? customer[0] : customer;
  return row?.name;
};

/**
 * Loads the room catalogue and its current occupants in one PostgREST request.
 * Status history is intentionally loaded only when the detail drawer opens.
 */
export async function loadUnitPageData() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .select(`
      id, building_id, code, unit_no, floor_label, kind, status, area_sqm, layout, furnishing, notes,
      building:buildings!inner(id, code, display_name, is_active),
      unit_business_flags(unit_id, business_type, is_enabled, default_price_xof),
      lease_contracts(unit_id, customer_id, expected_end_date, expected_end_confirmed, status, start_date, customer:customers(name)),
      sale_contracts(unit_id, customer_id, signed_date, status, customer:customers(name)),
      daily_bookings(unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, status, customer:customers(name))
    `)
    .eq("building.is_active", true)
    .eq("lease_contracts.status", "active")
    .eq("sale_contracts.status", "active")
    .in("daily_bookings.status", ["confirmed", "checked_in"])
    .order("unit_no");

  if (error) throw new Error(`Failed to load unit catalogue: ${error.message}`);

  const catalogUnits = (data ?? []) as unknown as CatalogUnit[];
  const buildingById = new Map<string, Pick<BuildingRow, "id" | "code" | "display_name">>();
  const businessFlagsMap: Record<string, UnitBusinessFlagRow[]> = {};
  const unitPartySummaries: Record<string, UnitPartySummary> = {};
  const managedLeaseUnitIds: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const unit of catalogUnits) {
    const building = Array.isArray(unit.building) ? unit.building[0] : unit.building;
    if (building) buildingById.set(building.id, building);

    businessFlagsMap[unit.id] = (unit.unit_business_flags ?? []) as UnitBusinessFlagRow[];

    const lease = [...(unit.lease_contracts ?? [])]
      .sort((left, right) => right.start_date.localeCompare(left.start_date))[0];
    const sale = [...(unit.sale_contracts ?? [])]
      .sort((left, right) => right.signed_date.localeCompare(left.signed_date))[0];
    const booking = [...(unit.daily_bookings ?? [])].sort((left, right) => {
      if (left.status === "checked_in" && right.status !== "checked_in") return -1;
      if (right.status === "checked_in" && left.status !== "checked_in") return 1;
      const leftFuture = left.check_in >= today ? 0 : 1;
      const rightFuture = right.check_in >= today ? 0 : 1;
      return leftFuture - rightFuture || left.check_in.localeCompare(right.check_in);
    })[0];

    if (lease) managedLeaseUnitIds.push(unit.id);
    unitPartySummaries[unit.id] = {
      leaseCustomerName: lease ? customerName(lease.customer) : undefined,
      leaseEndDate: lease?.expected_end_date ?? undefined,
      leaseEndConfirmed: lease ? lease.expected_end_confirmed !== false : undefined,
      saleCustomerName: sale ? customerName(sale.customer) : undefined,
      dailyCustomerName: booking ? customerName(booking.customer) : undefined,
      dailyDateText: booking
        ? `${booking.check_in} - ${booking.checkout_mode === "open" ? booking.actual_check_out ?? "未定" : booking.check_out ?? booking.check_in}`
        : undefined,
    };
  }

  const buildings = Array.from(buildingById.values()).sort((left, right) => left.code.localeCompare(right.code));
  const units = sortUnits(catalogUnits.map(({ building: _building, unit_business_flags: _flags, lease_contracts: _leases, sale_contracts: _sales, daily_bookings: _bookings, ...unit }) => unit as UnitRow));

  const sacsi11Id = buildings.find((building) => building.code === "SACSI11")?.id;
  const sacsi11503Id = units.find((unit) => unit.building_id === sacsi11Id && unit.unit_no === "503")?.id;
  if (sacsi11503Id) {
    businessFlagsMap[sacsi11503Id] = (businessFlagsMap[sacsi11503Id] ?? [])
      .filter((flag) => flag.business_type !== "daily_rental");
  }

  const sacsi7Storefront = units.find((unit) => unit.code === "SACSI7-STOREFRONT");
  if (sacsi7Storefront && !businessFlagsMap[sacsi7Storefront.id]?.some((flag) => flag.business_type === "long_lease")) {
    businessFlagsMap[sacsi7Storefront.id] = [
      ...(businessFlagsMap[sacsi7Storefront.id] ?? []),
      { unit_id: sacsi7Storefront.id, business_type: "long_lease", is_enabled: true, default_price_xof: 1_200_000 },
    ];
  }

  return {
    units,
    businessFlagsMap,
    managedLeaseUnitIds: Array.from(new Set(managedLeaseUnitIds)),
    unitPartySummaries,
    buildings,
  };
}
