import type { UnitRow } from "@/types/database";

type DisplayUnit = Pick<UnitRow, "code" | "floor_label" | "kind" | "unit_no">;

const SACSI5_FRONT_CODE = /^SACSI5-(?:[1-9]F-(?:FRONT|OFFICE))$/i;
const SACSI5_FRONT_PARTITION = /^([1-9])0[1-3]$/;

export function isSacsi5FrontOfficeUnit(buildingCode: string, unit: DisplayUnit): boolean {
  if (buildingCode !== "SACSI5") return false;
  if (unit.kind === "office" || SACSI5_FRONT_CODE.test(unit.code)) return true;

  const match = unit.unit_no.match(SACSI5_FRONT_PARTITION);
  if (!match) return false;
  const floor = Number(match[1]);
  return floor >= 1 && floor <= 9;
}

export function isSacsi5CompanyOwnedOffice(buildingCode: string, unit: DisplayUnit): boolean {
  return buildingCode === "SACSI5"
    && (unit.code === "SACSI5-8F-FRONT" || unit.code === "SACSI5-8F-OFFICE" || unit.unit_no === "8F前楼");
}

export function getSacsi5OfficeFloorTag(
  buildingCode: string,
  floorKey: string,
  hasActiveLease: boolean,
  hasCompanyOwnedOffice: boolean,
  locale: "zh" | "fr",
): string | null {
  if (buildingCode !== "SACSI5") return null;
  if (floorKey === "6" && hasActiveLease) return locale === "zh" ? "半层出租" : "Demi-étage loué";
  if (floorKey === "8" && hasCompanyOwnedOffice) return locale === "zh" ? "公司自购 · 自用" : "Acheté · usage interne";
  return null;
}
