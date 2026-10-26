import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { sortUnits } from "@/lib/utils";
import { isCurrentLease, isFutureLease } from "@/lib/lease-timing";
import type { UnitPartySummary } from "@/features/units/unit-party-summary";
import type { BuildingRow, UnitBusinessFlagRow, UnitRow } from "@/types/database";
import type { UnitPosition } from "./operational-position";

type RelatedCustomer = { name: string } | Array<{ name: string }> | null;

type CatalogBuilding = Pick<BuildingRow, "id" | "code" | "display_name"> & {
  project_id: string;
  project: { code: string; display_name: string } | Array<{ code: string; display_name: string }>;
};

type UnitListBuilding = Pick<BuildingRow, "id" | "code" | "display_name"> & {
  project_id: string;
  project_code: string;
  project_name: string;
};

type CatalogUnit = UnitRow & {
  building: CatalogBuilding | CatalogBuilding[];
  unit_business_flags: UnitBusinessFlagRow[];
  lease_contracts: Array<{
    customer_id: string;
    expected_end_date: string | null;
    expected_end_confirmed: boolean | null;
    start_date: string;
    status: string;
    customer: RelatedCustomer;
  }>;
  sale_contracts: Array<{
    customer_id: string;
    signed_date: string;
    customer: RelatedCustomer;
  }>;
  daily_bookings: Array<{
    customer_id: string;
    guest_customer_id: string | null;
    guest_name: string | null;
    check_in: string;
    check_out: string | null;
    checkout_mode: string | null;
    actual_check_out: string | null;
    status: string;
    guest_customer: RelatedCustomer;
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
  const [catalogUnits, positions] = await Promise.all([
    fetchAllPages<CatalogUnit>(
      (from, to) =>
        supabase
          .from("units")
          .select(
            `
      id, building_id, code, unit_no, floor_label, kind, status, area_sqm, layout, furnishing, notes,
      operational_condition, reservation_holder_name, created_at, updated_at,
      asset_subtype, construction_status, location_grade, zone_label, occupancy_verified,
      building:buildings!inner(id, code, display_name, is_active, project_id, project:projects(code, display_name)),
      unit_business_flags(unit_id, business_type, is_enabled, default_price_xof),
      lease_contracts(unit_id, customer_id, expected_end_date, expected_end_confirmed, status, start_date, customer:customers(name)),
      sale_contracts(unit_id, customer_id, signed_date, status, customer:customers(name)),
      daily_bookings(
        unit_id, customer_id, guest_customer_id, guest_name, check_in, check_out, checkout_mode, actual_check_out, status,
        guest_customer:customers!daily_bookings_guest_customer_id_fkey(name)
      )
    `,
            { count: "exact" },
          )
          .eq("building.is_active", true)
          .eq("lease_contracts.status", "active")
          .eq("sale_contracts.status", "active")
          .in("daily_bookings.status", ["confirmed", "checked_in"])
          .order("unit_no")
          .order("id")
          .range(from, to),
      "unit catalogue",
    ),
    fetchAllPages<UnitPosition & { id: string }>(
      (from, to) =>
        supabase
          .from("unit_operational_position")
          .select(
            "id,ownership,operational_condition,daily_occupied,lease_occupied,cleaning_pending,daily_enabled,lease_enabled,lease_pending,lease_start_date",
            { count: "exact" },
          )
          .order("id")
          .range(from, to),
      "unit operational dimensions",
    ),
  ]);
  const buildingById = new Map<string, UnitListBuilding>();
  const businessFlagsMap: Record<string, UnitBusinessFlagRow[]> = {};
  const unitPartySummaries: Record<string, UnitPartySummary> = {};
  const managedLeaseUnitIds: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const unit of catalogUnits) {
    const building = Array.isArray(unit.building) ? unit.building[0] : unit.building;
    if (building) {
      const project = Array.isArray(building.project) ? building.project[0] : building.project;
      buildingById.set(building.id, {
        id: building.id,
        code: building.code,
        display_name: building.display_name,
        project_id: building.project_id,
        project_code: project?.code ?? "SACSI",
        project_name: project?.display_name ?? "SACSI 公寓项目",
      });
    }

    businessFlagsMap[unit.id] = (unit.unit_business_flags ?? []) as UnitBusinessFlagRow[];

    const leases = unit.lease_contracts ?? [];
    const lease = leases
      .filter((row) => isCurrentLease(row, today))
      .sort((left, right) => right.start_date.localeCompare(left.start_date))[0];
    const pendingLease = leases
      .filter((row) => isFutureLease(row, today))
      .sort((left, right) => left.start_date.localeCompare(right.start_date))[0];
    const sale = [...(unit.sale_contracts ?? [])].sort((left, right) =>
      right.signed_date.localeCompare(left.signed_date),
    )[0];
    const booking = [...(unit.daily_bookings ?? [])].sort((left, right) => {
      if (left.status === "checked_in" && right.status !== "checked_in") return -1;
      if (right.status === "checked_in" && left.status !== "checked_in") return 1;
      const leftFuture = left.check_in >= today ? 0 : 1;
      const rightFuture = right.check_in >= today ? 0 : 1;
      return leftFuture - rightFuture || left.check_in.localeCompare(right.check_in);
    })[0];

    if (leases.length) managedLeaseUnitIds.push(unit.id);
    unitPartySummaries[unit.id] = {
      leaseCustomerName: lease ? customerName(lease.customer) : undefined,
      leaseEndDate: lease?.expected_end_date ?? undefined,
      leaseEndConfirmed: lease ? lease.expected_end_confirmed !== false : undefined,
      pendingLeaseCustomerName: pendingLease ? customerName(pendingLease.customer) : undefined,
      pendingLeaseEndDate: pendingLease?.expected_end_date ?? undefined,
      pendingLeaseEndConfirmed: pendingLease
        ? pendingLease.expected_end_confirmed !== false
        : undefined,
      saleCustomerName: sale ? customerName(sale.customer) : undefined,
      dailyCustomerName: booking
        ? customerName(booking.guest_customer) || booking.guest_name?.trim()
        : undefined,
      dailyStatus: booking?.status,
      dailyDateText: booking
        ? `${booking.check_in} - ${booking.checkout_mode === "open" ? (booking.actual_check_out ?? "未定") : (booking.check_out ?? booking.check_in)}`
        : undefined,
    };
  }

  const buildings = Array.from(buildingById.values()).sort((left, right) =>
    left.code.localeCompare(right.code),
  );
  const units = sortUnits(
    catalogUnits.map(
      ({
        building: _building,
        unit_business_flags: _flags,
        lease_contracts: _leases,
        sale_contracts: _sales,
        daily_bookings: _bookings,
        ...unit
      }) => unit as UnitRow,
    ),
  );

  return {
    units,
    positionsMap: Object.fromEntries(positions.map((position) => [position.id, position])),
    businessFlagsMap,
    managedLeaseUnitIds: Array.from(new Set(managedLeaseUnitIds)),
    unitPartySummaries,
    buildings,
  };
}
