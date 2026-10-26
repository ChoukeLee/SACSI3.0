import type { Locale } from "@/lib/i18n";
import type { UnitRow } from "@/types/database";

export interface UnitPosition {
  id?: string;
  ownership: "sold" | "unspecified";
  operational_condition: string;
  daily_occupied: boolean;
  lease_occupied: boolean;
  /** An active future lease reserves the asset without counting as current occupation. */
  lease_pending?: boolean;
  lease_start_date?: string | null;
  cleaning_pending: boolean;
  daily_enabled: boolean;
  lease_enabled: boolean;
}

export function pendingLeaseLabel(
  position: UnitPosition | null | undefined,
  locale: Locale,
): string | null {
  if (!position?.lease_pending) return null;
  return `${locale === "zh" ? "待起租" : "À venir"}${position.lease_start_date ? ` · ${position.lease_start_date}` : ""}`;
}

export function conditionLabel(condition: string | undefined, locale: Locale): string {
  const labels: Record<string, { zh: string; fr: string }> = {
    normal: { zh: "正常", fr: "Normal" },
    maintenance: { zh: "维修中", fr: "Maintenance" },
    locked: { zh: "封锁", fr: "Bloqué" },
  };
  return condition
    ? (labels[condition]?.[locale] ?? condition)
    : locale === "zh"
      ? "待核实"
      : "À vérifier";
}

/** Filters use independent dimensions: a sold asset may still be leased. */
export function matchesUnitPosition(
  unit: UnitRow,
  position: UnitPosition | undefined,
  filter: string,
  dailyStatus?: string,
): boolean {
  if (filter === "all") return true;
  if (!position) return false;
  if (filter === "sold") return position.ownership === "sold";
  if (filter === "leased") return position.lease_occupied;
  if (filter === "daily_occupied") return position.daily_occupied;
  if (filter === "reserved") return dailyStatus === "confirmed";
  if (filter === "cleaning_pending") return position.cleaning_pending;
  if (filter === "maintenance" || filter === "locked")
    return position.operational_condition === filter;
  // No current occupation is not a claim that a property is ready to rent.
  if (filter === "available") return !position.daily_occupied && !position.lease_occupied;
  return unit.status === filter;
}
