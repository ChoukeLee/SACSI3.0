import type { UnitRow } from "@/types/database";

export function unitBuildingLabel(unit: Pick<UnitRow, "code">): string {
  const match = unit.code?.match(/^SACSI(\d+)(?:-|$)/i);
  return match ? `${match[1]}#` : "";
}

export function qualifiedUnitNo(unit: Pick<UnitRow, "code" | "unit_no">): string {
  return `${unitBuildingLabel(unit)}${unit.unit_no}`;
}
