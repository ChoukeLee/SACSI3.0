import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatXof(amount: number | string | null | undefined) {
  const value = Number(amount ?? 0);
  const safeValue = Number.isFinite(value) ? value : 0;
  const valueInTenThousands = safeValue / 10000;

  return `${new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valueInTenThousands)}万 FCFA`;
}

function firstNumber(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function compareUnitNo(a: string | null | undefined, b: string | null | undefined) {
  const aText = String(a ?? "");
  const bText = String(b ?? "");
  const aNum = firstNumber(aText);
  const bNum = firstNumber(bText);

  if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum;
  if (aNum !== null && bNum === null) return -1;
  if (aNum === null && bNum !== null) return 1;

  return aText.localeCompare(bText, undefined, { numeric: true, sensitivity: "base" });
}

export function compareUnits<T extends { unit_no: string | null; floor_label?: string | null }>(a: T, b: T) {
  const roomOrder = compareUnitNo(a.unit_no, b.unit_no);
  if (roomOrder !== 0) return roomOrder;

  const aFloor = firstNumber(a.floor_label);
  const bFloor = firstNumber(b.floor_label);
  if (aFloor !== null && bFloor !== null && aFloor !== bFloor) return aFloor - bFloor;
  return String(a.floor_label ?? "").localeCompare(String(b.floor_label ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

export function sortUnits<T extends { unit_no: string | null; floor_label?: string | null }>(units: T[]): T[] {
  return [...units].sort(compareUnits);
}

export function sortUnitsForBuilding<T extends { unit_no: string | null; floor_label?: string | null }>(units: T[], buildingCode?: string | null): T[] {
  if (buildingCode !== "SACSI3") return sortUnits(units);

  return [...units].sort((a, b) => {
    const floorOrder = compareFloorLabels(a.floor_label, b.floor_label);
    return floorOrder !== 0 ? floorOrder : compareUnitNo(a.unit_no, b.unit_no);
  });
}

export function normalizeFloorLabel(floorLabel: string | null, unitNo: string): string {
  if (floorLabel && floorLabel.trim()) {
    const raw = floorLabel.trim();
    if (/^(G|G层|G楼|GF|G\/F|GROUND|GROUND FLOOR|RDC|底层|地面层)$/i.test(raw)) return "G";
    // Strip "楼" and "层", extract the floor number, append "F"
    const cleaned = raw.replace(/[楼层]/g, "").trim();
    const match = cleaned.match(/\d+/);
    if (match) return `${match[0]}F`;
  }
  const numeric = Number.parseInt(unitNo, 10);
  if (Number.isFinite(numeric)) return `${Math.floor(numeric / 100)}F`;
  return "F";
}

export function floorSortValue(label: string): number {
  const raw = String(label ?? "").trim();
  if (!raw) return 9999;
  if (/^(G|G层|G楼|GF|G\/F|GROUND|GROUND FLOOR|RDC|底层|地面层)$/i.test(raw)) return -1;
  const cleaned = raw.replace(/[楼层]/g, "").trim();
  const match = cleaned.match(/-?\d+/);
  return match ? Number.parseInt(match[0], 10) : 9999;
}

export function compareFloorLabels(a: string | null | undefined, b: string | null | undefined) {
  const diff = floorSortValue(String(a ?? "")) - floorSortValue(String(b ?? ""));
  if (diff !== 0) return diff;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
}
