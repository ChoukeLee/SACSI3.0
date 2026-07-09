import type { UnitRow } from "@/types/database";

const OWNER_OCCUPIED_PATTERN = /self-use|owner-occupied|owner occupied|internal office|自用|自持|内部办公室|集团办公室|科建办公室|科建集团办公室/i;

export function isOwnerOccupiedUnit(unit: Pick<UnitRow, "notes" | "status">): boolean {
  return unit.status === "locked" && OWNER_OCCUPIED_PATTERN.test(unit.notes ?? "");
}

export function getUnitOperationalLabel(unit: Pick<UnitRow, "notes" | "status">, locale: "zh" | "fr"): string | null {
  if (isOwnerOccupiedUnit(unit)) {
    return locale === "zh" ? "自用" : "Usage interne";
  }
  return null;
}
