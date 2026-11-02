import type { UnitConstructionStatus } from "@/types/domain";

export const cimacApartmentFloors = [2, 3, 4, 5] as const;
export type CimacApartmentFloor = (typeof cimacApartmentFloors)[number];
export type CimacApartmentFacing = "east" | "west";
export const cimacApartmentEastSuffixes = [1, 3, 5, 7, 9, 10, 12, 13, 15] as const;
export const cimacApartmentWestSuffixes = [2, 4, 6, 8, 11, 14, 16] as const;
export const cimacApartmentTwoBedroomSuffixes = [11, 15, 16] as const;

export interface CimacApartmentPlan {
  unitNo: string;
  floor: CimacApartmentFloor;
  suffix: number;
  bedrooms: 1 | 2;
  facing: CimacApartmentFacing;
  monthlyRentXof: number;
  monthlyPropertyFeeXof: number;
  depositMonths: 2;
  rentPrepayMonths: 6;
  propertyPrepayMonths: 12;
}
export interface CimacApartmentRoom extends CimacApartmentPlan {
  unitId: string | null;
  registered: boolean;
  constructionStatus: UnitConstructionStatus | null;
  occupancyState: "unknown" | "occupied" | "unoccupied";
  operationalCondition: "normal" | "maintenance" | "locked" | null;
  areaSqm: number | null;
}
export interface CimacApartmentData {
  projectId: string;
  buildingId: string;
  buildingName: string;
  rooms: CimacApartmentRoom[];
  registeredCount: number;
  schemaAvailable: boolean;
}
export interface CimacApartmentQuery {
  floor: CimacApartmentFloor;
  suffix: number;
  tab: "room" | "fees";
}
export type CimacApartmentInitializationResult =
  | { success: false; error: string }
  | { success: true; requestId: string; roomCount: 64; idempotent: boolean };

/** User-confirmed catalogue, not an assertion that assets have been registered or occupied. */
export function cimacApartmentPlan(): CimacApartmentPlan[] {
  return cimacApartmentFloors.flatMap((floor) =>
    Array.from({ length: 16 }, (_, index): CimacApartmentPlan => {
      const suffix = index + 1;
      const bedrooms = cimacApartmentTwoBedroomSuffixes.some((n) => n === suffix) ? 2 : 1;
      return {
        unitNo: String(floor * 100 + suffix),
        floor,
        suffix,
        bedrooms,
        facing: cimacApartmentEastSuffixes.some((n) => n === suffix) ? "east" : "west",
        monthlyRentXof: bedrooms === 1 ? 350000 : 600000,
        monthlyPropertyFeeXof: bedrooms === 1 ? 30000 : 40000,
        depositMonths: 2,
        rentPrepayMonths: 6,
        propertyPrepayMonths: 12,
      };
    }),
  );
}

export function cimacApartmentFees(room: CimacApartmentPlan) {
  const depositXof = room.monthlyRentXof * room.depositMonths;
  const prepaidRentXof = room.monthlyRentXof * room.rentPrepayMonths;
  const annualPropertyFeeXof = room.monthlyPropertyFeeXof * room.propertyPrepayMonths;
  return {
    depositXof,
    prepaidRentXof,
    annualPropertyFeeXof,
    standardInitialTotalXof: depositXof + prepaidRentXof + annualPropertyFeeXof,
  };
}

export function parseCimacApartmentQuery(raw: Record<string, unknown>): CimacApartmentQuery {
  if (
    Object.keys(raw).some((key) => !["floor", "room", "tab"].includes(key)) ||
    Object.values(raw).some((value) => value !== undefined && typeof value !== "string")
  )
    throw new Error("CimacApartmentInvalidQuery");
  const floor = raw.floor ?? "2";
  const room = raw.room ?? `${floor}01`;
  const tab = raw.tab ?? "fees";
  if (
    !/^[2-5]$/.test(String(floor)) ||
    !/^[2-5](?:0[1-9]|1[0-6])$/.test(String(room)) ||
    String(room)[0] !== floor ||
    (tab !== "room" && tab !== "fees")
  )
    throw new Error("CimacApartmentInvalidQuery");
  return {
    floor: Number(floor) as CimacApartmentFloor,
    suffix: Number(room) % 100,
    tab,
  };
}
