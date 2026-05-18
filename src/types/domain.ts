export type BuildingCode =
  | "SASCI3"
  | "SASCI4"
  | "SASCI5"
  | "SASCI6"
  | "SASCI7"
  | "SASCI11";

export type BusinessType = "daily_rental" | "long_lease" | "sale";

export type UnitKind = "apartment" | "parking" | "storefront" | "office";

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
