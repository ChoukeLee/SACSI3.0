import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitConstructionStatus } from "@/types/domain";
import { assertCimacWorkspaceScope } from "./cimac-workspace-model";
import { CimacWorkspaceReadError, type CimacWorkspaceScope } from "./cimac-workspace-types";
import { cimacWorkspaceId } from "./cimac-workspace-query";
import {
  apartmentTimestamp,
  apartmentUuid,
  type CimacApartmentReservation,
} from "./cimac-apartment-reservation-model";
import {
  cimacApartmentPlan,
  cimacApartmentInitialReferenceTerms,
  type CimacApartmentData,
  type CimacApartmentPlan,
  type CimacApartmentRoom,
} from "./cimac-apartment-model";

type Client = Pick<SupabaseClient, "from">;
type Row = Record<string, unknown>;
const fail = (): never => {
  throw new CimacWorkspaceReadError();
};
const object = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Row;
};
const constructionStates = [
  "planned",
  "under_construction",
  "inspection_pending",
  "fitout_pending",
  "operational",
  "paused",
  "unverified",
];
const profileFields =
  "unit_id,building_id,floor_number,room_suffix,bedrooms,facing,monthly_rent_xof,monthly_property_fee_xof,deposit_months,rent_prepay_months,property_prepay_months";
const unitFields =
  "id,building_id,code,unit_no,kind,asset_subtype,floor_label,area_sqm,construction_status,occupancy_verified,updated_at";
const positionFields = "id,building_id,operational_condition,daily_occupied,lease_occupied";
const columns: [string, keyof CimacApartmentPlan][] = [
  ["floor_number", "floor"],
  ["room_suffix", "suffix"],
  ["bedrooms", "bedrooms"],
  ["monthly_rent_xof", "monthlyRentXof"],
  ["monthly_property_fee_xof", "monthlyPropertyFeeXof"],
  ["deposit_months", "depositMonths"],
  ["property_prepay_months", "propertyPrepayMonths"],
];
function exactRows(result: {
  data: unknown[] | null;
  error: { code?: string } | null;
  count?: number | null;
}): Row[] {
  if (result.error) throw new CimacWorkspaceReadError(result.error.code === "42501" ? 403 : 503);
  if (!Array.isArray(result.data) || result.count !== result.data.length || result.data.length > 64)
    return fail();
  return result.data.map(object);
}

/** No global cache: every read uses the current actor's project and row-level permissions. */
export async function readCimacApartments(
  client: Client,
  scope: CimacWorkspaceScope,
): Promise<CimacApartmentData> {
  assertCimacWorkspaceScope(scope);
  const buildings = scope.buildings.filter((b) => b.code === "CIMAC-B17" && b.isActive);
  if (buildings.length !== 1) throw new CimacWorkspaceReadError(403);
  const building = buildings[0];
  const plans = cimacApartmentPlan();
  const emptyRooms: CimacApartmentRoom[] = plans.map((plan) => ({
    ...plan,
    registered: false,
    unitId: null,
    constructionStatus: null,
    occupancyState: "unknown",
    operationalCondition: null,
    areaSqm: null,
    unitUpdatedAt: null,
    reservation: null,
  }));
  const data = (
    rooms: CimacApartmentRoom[],
    schemaAvailable = true,
    reservationSchemaAvailable = false,
  ): CimacApartmentData => ({
    projectId: scope.project.id,
    buildingId: building.id,
    buildingName: building.name,
    rooms,
    schemaAvailable,
    reservationSchemaAvailable,
    registeredCount: rooms.filter((r) => r.registered).length,
  });
  const result = await client
    .from("cimac_apartment_profiles")
    .select(profileFields, { count: "exact" })
    .eq("building_id", building.id)
    .order("floor_number")
    .order("room_suffix")
    .range(0, 64);
  // Explicit not-deployed state; never disguise unrelated failures as an empty inventory.
  if (result.error && ["42P01", "PGRST205"].includes(result.error.code))
    return data(emptyRooms, false);
  const profiles = exactRows(result);
  if (!profiles.length) return data(emptyRooms);
  const profilesByNumber = new Map<string, Row>();
  const seenIds = new Set<string>();
  for (const profile of profiles) {
    const id = cimacWorkspaceId(profile.unit_id);
    if (profile.building_id !== building.id || seenIds.has(id)) return fail();
    seenIds.add(id);
    const number = String(Number(profile.floor_number) * 100 + Number(profile.room_suffix));
    const plan = plans.find((r) => r.unitNo === number);
    if (
      !plan ||
      profilesByNumber.has(number) ||
      profile.facing !== plan.facing ||
      // Profiles preserve the original audited initialization; today's quote is in plan.
      String(profile.rent_prepay_months) !==
        String(cimacApartmentInitialReferenceTerms.rentPrepayMonths) ||
      columns.some(
        ([field, key]) => profile[field] === null || String(profile[field]) !== String(plan[key]),
      )
    )
      return fail();
    profilesByNumber.set(number, profile);
  }
  const ids = [...seenIds];
  const [unitResult, positionResult, reservationResult] = await Promise.all([
    client
      .from("units")
      .select(unitFields, { count: "exact" })
      .eq("building_id", building.id)
      .in("id", ids)
      .order("id")
      .range(0, 64),
    client
      .from("unit_operational_position")
      .select(positionFields, { count: "exact" })
      .eq("building_id", building.id)
      .in("id", ids)
      .order("id")
      .range(0, 64),
    client
      .from("cimac_apartment_reservations")
      .select("id,unit_id,building_id,reserver_name,status,payment_status,updated_at", {
        count: "exact",
      })
      .eq("building_id", building.id)
      .eq("status", "reserved")
      .in("unit_id", ids)
      .order("unit_id")
      .range(0, 64),
  ]);
  const units = exactRows(unitResult);
  const positions = exactRows(positionResult);
  const reservationSchemaAvailable =
    !reservationResult.error || !["42P01", "PGRST205"].includes(reservationResult.error.code);
  const reservations = reservationSchemaAvailable ? exactRows(reservationResult) : [];
  const reservationMap = new Map<string, CimacApartmentReservation>();
  for (const reservation of reservations) {
    const unitId = cimacWorkspaceId(reservation.unit_id);
    if (
      !seenIds.has(unitId) ||
      reservationMap.has(unitId) ||
      reservation.building_id !== building.id ||
      !apartmentUuid(reservation.id) ||
      reservation.status !== "reserved" ||
      reservation.payment_status !== "unpaid" ||
      typeof reservation.reserver_name !== "string" ||
      !reservation.reserver_name.trim() ||
      reservation.reserver_name.length > 200 ||
      !apartmentTimestamp(reservation.updated_at)
    )
      return fail();
    reservationMap.set(unitId, {
      id: reservation.id,
      reserverName: reservation.reserver_name,
      status: "reserved",
      paymentStatus: "unpaid",
      updatedAt: reservation.updated_at,
    });
  }
  if (units.length !== profiles.length) return fail();
  const unitMap = new Map<string, Row>(),
    positionMap = new Map<string, Row>();
  for (const unit of units) {
    const id = cimacWorkspaceId(unit.id);
    if (!seenIds.has(id) || unitMap.has(id) || unit.building_id !== building.id) return fail();
    unitMap.set(id, unit);
  }
  for (const position of positions) {
    const id = cimacWorkspaceId(position.id);
    if (
      !seenIds.has(id) ||
      positionMap.has(id) ||
      position.building_id !== building.id ||
      !["normal", "maintenance", "locked"].includes(String(position.operational_condition)) ||
      typeof position.daily_occupied !== "boolean" ||
      typeof position.lease_occupied !== "boolean"
    )
      return fail();
    positionMap.set(id, position);
  }
  const rooms = emptyRooms.map((room): CimacApartmentRoom => {
    const profile = profilesByNumber.get(room.unitNo);
    if (!profile) return room;
    const unit = unitMap.get(String(profile.unit_id));
    if (
      !unit ||
      unit.unit_no !== room.unitNo ||
      unit.code !== `CIMAC-B17-${room.unitNo}` ||
      unit.kind !== "apartment" ||
      unit.asset_subtype !== "apartment" ||
      unit.floor_label !== `${room.floor}F` ||
      typeof unit.occupancy_verified !== "boolean" ||
      !constructionStates.includes(String(unit.construction_status)) ||
      !apartmentTimestamp(unit.updated_at)
    )
      return fail();
    const area = unit.area_sqm === null ? null : Number(unit.area_sqm);
    if (area !== null && (!Number.isFinite(area) || area <= 0)) return fail();
    const position = positionMap.get(String(unit.id));
    return {
      ...room,
      registered: true,
      unitId: String(unit.id),
      unitUpdatedAt: unit.updated_at,
      reservation: reservationMap.get(String(unit.id)) ?? null,
      areaSqm: area,
      constructionStatus: unit.construction_status as UnitConstructionStatus,
      operationalCondition: position
        ? (position.operational_condition as "normal" | "maintenance" | "locked")
        : null,
      occupancyState:
        !unit.occupancy_verified || !position
          ? "unknown"
          : position.daily_occupied || position.lease_occupied
            ? "occupied"
            : "unoccupied",
    };
  });
  return data(rooms, true, reservationSchemaAvailable);
}
