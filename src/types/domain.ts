// Building codes are data-driven. Keeping this open avoids a code release for
// every new building imported under a project such as CIMAC.
export type BuildingCode = string;

export type ProjectCode = string;

export type ProjectConstructionStatus =
  | "planned"
  | "under_construction"
  | "inspection_pending"
  | "fitout_pending"
  | "partially_operational"
  | "operational"
  | "paused"
  | "unverified";

export type UnitConstructionStatus = Exclude<ProjectConstructionStatus, "partially_operational">;

export type LocationGrade = "standard" | "central_avenue_prime";

export type AssetSubtype =
  | "standard"
  | "apartment"
  | "parking"
  | "storefront"
  | "office"
  | "commercial_shop"
  | "apartment_ground_floor_shop"
  | "warehouse";

export type BusinessType = "daily_rental" | "long_lease" | "sale";

export type UnitKind = "apartment" | "parking" | "storefront" | "office" | "warehouse";

export type UnitStatus =
  | "available"
  | "reserved"
  | "daily_occupied"
  | "cleaning_pending"
  | "leased"
  | "sold"
  | "maintenance"
  | "locked";

export type PaymentStatus = "pending" | "paid" | "overdue" | "cancelled";

export type ContractStatus = "draft" | "active" | "terminated" | "expired";

export type CurrencyCode = "XOF" | "CNY";

export interface Building {
  id: string;
  code: BuildingCode;
  displayName: string;
  active: boolean;
  address?: string;
  floorsAboveGround: number;
  elevatorCount: number;
}

export interface Unit {
  id: string;
  buildingCode: BuildingCode;
  unitNo: string;
  floorLabel: string;
  kind: UnitKind;
  status: UnitStatus;
  areaSqm?: number;
  layout?: string;
  furnishing?: "none" | "basic" | "full";
  supports: BusinessType[];
  defaultDailyPriceXof?: number;
}

export interface ModuleCard {
  title: string;
  description: string;
  href: string;
  metric: string;
  accent: "orange" | "green" | "ink";
}
