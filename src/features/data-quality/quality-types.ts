export type QualitySeverity = "high" | "medium" | "low";
export type QualityCategory = "unit" | "customer" | "daily_rental" | "lease" | "sale" | "finance" | "system";
export type QualityStatus = "open" | "ignored" | "fixed";

export interface QualityIssue {
  id: string;
  severity: QualitySeverity;
  category: QualityCategory;
  title: string;
  description: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string;
  relatedEntities: string[];
  href: string;
  suggestedAction: string;
  detectedAt: string;
  status: QualityStatus;
}

export type TodoRole = "admin" | "boss" | "finance" | "front_desk";

export const CATEGORY_ROLES: Record<QualityCategory, TodoRole[]> = {
  unit:         ["admin", "boss"],
  customer:     ["admin", "boss", "front_desk"],
  daily_rental: ["admin", "boss", "front_desk", "finance"],
  lease:        ["admin", "boss", "finance"],
  sale:         ["admin", "boss", "finance"],
  finance:      ["admin", "boss", "finance"],
  system:       ["admin", "boss"],
};
