import type { ResolvedTimeRange } from "./query-plan";

function comparableName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesCustomerName(value: string | null | undefined, filter: string | null | undefined) {
  if (!filter) return true;
  if (!value) return false;
  return comparableName(value).includes(comparableName(filter));
}

export function dateIsWithinRange(value: string | null | undefined, range: ResolvedTimeRange) {
  if (!value) return false;
  if (range.startDate) {
    if (range.startInclusive ? value < range.startDate : value <= range.startDate) return false;
  }
  if (range.endDate) {
    if (range.endInclusive ? value > range.endDate : value >= range.endDate) return false;
  }
  return true;
}

export function queryRangeLabel(range: ResolvedTimeRange, locale: "zh" | "fr" = "zh") {
  if (!range.startDate && !range.endDate) return "—";
  if (range.startDate === range.endDate) return range.startDate ?? range.endDate ?? "—";
  if (locale === "fr") {
    return `du ${range.startDate ?? "…"}${range.startInclusive ? " inclus" : " exclu"} au ${range.endDate ?? "…"}${range.endInclusive ? " inclus" : " exclu"}`;
  }
  return `${range.startDate ?? "…"}${range.startInclusive ? "（含）" : "（不含）"}至 ${range.endDate ?? "…"}${range.endInclusive ? "（含）" : "（不含）"}`;
}
