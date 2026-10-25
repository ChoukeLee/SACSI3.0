import type {
  CustomerDirectoryProfile,
  CustomerDirectoryRow,
  CustomerRelation,
} from "@/features/customers/customer-directory-model";
import type { UnitPosition } from "@/features/units/operational-position";
import type { UnitBusinessRelation } from "@/features/units/unit-workbench-model";
import type { UnitKind } from "@/types/domain";

export interface CimacWorkspaceBuilding {
  id: string;
  code: string;
  name: string;
  constructionStatus: string | null;
  isActive: boolean;
}
export interface CimacWorkspaceScope {
  project: { id: string; code: "CIMAC"; displayName: string };
  buildings: CimacWorkspaceBuilding[];
}
export type CimacWorkspaceSection = "home" | "customers" | "assets";
export type CimacWorkspaceTab = "overview" | "contracts" | "account" | "records" | "service";
export interface CimacWorkspaceQuery {
  project: string;
  q: string;
  building: string;
  kind: string;
  filter: string;
  page: number;
  relationPage: number;
  tab: CimacWorkspaceTab;
  returnTo: string | null;
  accountTab?: "bills" | "receipts" | "meters" | "rules";
}
export type CimacAssetAttentionReason =
  | "construction_unverified"
  | "construction_pending"
  | "occupancy_unverified"
  | "maintenance"
  | "locked";
export interface CimacAssetSummary {
  id: string;
  code: string;
  unitNo: string;
  kind: UnitKind;
  assetSubtype: string | null;
  buildingId: string;
  buildingName: string;
  buildingCode: string;
  floorLabel: string;
  areaSqm: number | null;
  updatedAt: string | null;
  constructionStatus: string | null;
  occupancyVerified: boolean | null;
  position: UnitPosition | null;
  attentionReasons: CimacAssetAttentionReason[];
  handover: { status: "unknown"; date: null };
  opening: { status: "unknown"; date: null };
}
export interface CimacAssetCounts {
  total: number;
  occupied: number;
  unoccupied: number;
  occupancyUnknown: number;
  constructionUnknown: number;
  constructionPending: number;
  maintenance: number;
  locked: number;
  byKind: Record<UnitKind, number>;
}
export interface CimacHomeData {
  scope: CimacWorkspaceScope;
  assetSummary: CimacAssetCounts;
  customerCount: number;
  attention: CimacAssetSummary[];
  attentionTotal: number;
  assetIndex: CimacAssetSummary[];
  readAt: string;
}
export interface CimacCustomerDirectoryData {
  scope: CimacWorkspaceScope;
  query: CimacWorkspaceQuery;
  rows: CustomerDirectoryRow[];
  total: number;
  page: number;
  pageSize: 40;
}
export interface CimacCustomerData {
  scope: CimacWorkspaceScope;
  profile: CustomerDirectoryProfile;
  summary: CustomerDirectoryRow;
  relations: CustomerRelation[];
  relationPage: number;
  relationTotal: number;
  pageSize: 25;
  query: CimacWorkspaceQuery;
}
export interface CimacAssetDirectoryData {
  scope: CimacWorkspaceScope;
  query: CimacWorkspaceQuery;
  rows: CimacAssetSummary[];
  summary: CimacAssetCounts;
  total: number;
  page: number;
  pageSize: 50;
}
export interface CimacAssetData {
  scope: CimacWorkspaceScope;
  asset: CimacAssetSummary;
  relations: UnitBusinessRelation[];
  relationPage: number;
  relationTotal: number;
  pageSize: 30;
  query: CimacWorkspaceQuery;
}
export class CimacWorkspaceReadError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 413 | 503 = 503) {
    super("CimacWorkspaceUnavailable");
  }
}
