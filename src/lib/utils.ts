import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatXof(amount: number) {
  return new Intl.NumberFormat("fr-CI", {
    style: "currency",
    currency: "XOF",
    maximumFractionDigits: 0
  }).format(amount);
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

export function normalizeFloorLabel(floorLabel: string | null, unitNo: string): string {
  if (floorLabel && floorLabel.trim()) return floorLabel.trim().replace("楼", "F");
  const numeric = Number.parseInt(unitNo, 10);
  if (Number.isFinite(numeric)) return `${Math.floor(numeric / 100)}F`;
  return "F";
}

export function floorSortValue(label: string): number {
  const match = label.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 999;
}
