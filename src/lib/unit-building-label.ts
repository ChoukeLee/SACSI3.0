import type { UnitRow } from "@/types/database";

export function unitBuildingLabel(unit: Pick<UnitRow, "code">): string {
  // SACSI11 was imported before numbered building codes were standardized,
  // so its units use `SACSI-<room>` while later buildings use `SACSI5-<room>`.
  if (/^SACSI-/i.test(unit.code ?? "")) return "11#";
  const match = unit.code?.match(/^SACSI(\d+)(?:-|$)/i);
  return match ? `${match[1]}#` : "";
}

export function qualifiedUnitNo(unit: Pick<UnitRow, "code" | "unit_no">): string {
  return `${unitBuildingLabel(unit)}${unit.unit_no}`;
}
